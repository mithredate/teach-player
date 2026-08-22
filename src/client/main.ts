// ADR 0016: the terminal moved to the real one via PTY passthrough — this page is only
// the content pane now. The ws connection carries fsevent frames in and inject/report frames out.

// ADR 0015 hardening: allow-same-origin means a lesson iframe could otherwise spoof or
// intercept postMessage — both the sender's identity (source) and its origin must match
// the content iframe before a frame is trusted. Pure and exported so it's testable
// without a browser (test/unit/main.test.js uses plain fake objects, no DOM).
// ADR 0017: generalized from extractInjectText — inject and report share the same source+origin
// proof, only the frame shape differs. Report payloads pass through untouched; the server's
// buildJournalEntry does the real validation, this guard only proves the iframe origin.
export function extractForwardFrame(
  event: { source: unknown; origin: string; data: unknown },
  contentWindow: unknown,
  contentOrigin: string,
): Record<string, unknown> | null {
  if (event.source !== contentWindow || event.origin !== contentOrigin) return null;
  const data = event.data as { type?: unknown; text?: unknown } | null | undefined;
  if (data?.type === "inject" && typeof data.text === "string" && data.text) return { type: "inject", text: data.text };
  if (data?.type === "report") return data as Record<string, unknown>;
  return null;
}

// ADR 0021 decision 3: a flat, sorted-by-full-path list isn't sorted the way a tree reads —
// each level needs its own folders-first-then-A→Z pass. Pure and exported for the same
// no-DOM-needed reason as extractForwardFrame above.
export type TreeNode = { name: string; path: string; children?: TreeNode[] };

export function treeFrom(paths: string[]): TreeNode[] {
  type Building = { name: string; path: string; folders: Map<string, Building>; files: TreeNode[] };
  const root: Building = { name: "", path: "", folders: new Map(), files: [] };

  for (const path of paths) {
    const parts = path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i];
      let next = node.folders.get(name);
      if (!next) {
        next = { name, path: parts.slice(0, i + 1).join("/"), folders: new Map(), files: [] };
        node.folders.set(name, next);
      }
      node = next;
    }
    node.files.push({ name: parts[parts.length - 1], path });
  }

  function finish(node: Building): TreeNode[] {
    const folders = [...node.folders.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((folder) => ({ name: folder.name, path: folder.path, children: finish(folder) }));
    const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
    return [...folders, ...files];
  }

  return finish(root);
}

// DOM wiring only runs in a browser — this module doubles as the import target for the
// unit test above, where `document` doesn't exist.
if (typeof document !== "undefined") {
  const socket = new WebSocket(`ws://${location.host}/`);

  // ADR 0015: the pane lives on its own origin — the control server string-replaced this at serve time.
  const contentOrigin = document.body.dataset.contentOrigin!;

  // ADR 0017: sidebar-footer status dot + sent-log strip, fed by ws lifecycle and inject acks.
  const statusDot = document.getElementById("status-dot")!;
  const statusLabel = document.getElementById("status-label")!;
  function setStatus(state: string) {
    statusDot.dataset.status = state;
    statusLabel.textContent = state;
  }
  setStatus("disconnected");
  socket.onopen = () => setStatus("connected");
  socket.onclose = () => setStatus("disconnected");

  // FIFO: an inject's ack carries no text back, so line up sent texts in send order to match them to acks.
  const pendingInjects: string[] = [];
  const sentLog: string[] = [];
  const sentLogEl = document.getElementById("sent-log") as HTMLUListElement;
  function renderSentLog() {
    sentLogEl.replaceChildren(
      ...sentLog.slice(0, 5).map((text) => {
        const item = document.createElement("li");
        item.textContent = text;
        return item;
      }),
    );
  }

  // ADR 0021: the sidebar tree replaces the `<select>` picker — folders are native
  // <details>/<summary> (decision 2, free collapse, nothing to persist), files are buttons.
  const tree = document.getElementById("tree") as HTMLElement;
  const content = document.getElementById("content") as HTMLIFrameElement;

  const fetchFiles = (): Promise<string[]> => fetch("/_tp/files").then((response) => response.json());

  function buildTree(nodes: TreeNode[]): DocumentFragment {
    const fragment = document.createDocumentFragment();
    for (const node of nodes) {
      if (node.children) {
        const details = document.createElement("details");
        details.dataset.path = node.path;
        const summary = document.createElement("summary");
        summary.textContent = node.name;
        details.append(summary, buildTree(node.children));
        fragment.append(details);
      } else {
        const button = document.createElement("button");
        button.className = "file";
        button.textContent = node.name;
        button.dataset.path = node.path;
        fragment.append(button);
      }
    }
    return fragment;
  }

  function findFileButton(path: string): HTMLButtonElement | null {
    return [...tree.querySelectorAll<HTMLButtonElement>("button.file")].find((button) => button.dataset.path === path) ?? null;
  }

  let selectedPath: string | null = null;
  function moveHighlight(path: string | null) {
    selectedPath = path;
    tree.querySelectorAll("button.file.selected").forEach((button) => button.classList.remove("selected"));
    if (path) findFileButton(path)?.classList.add("selected");
  }

  // Step 4 (pre-ADR-0021): rebuilding on an fsevent needs to know which paths were already
  // listed, to badge only the new ones. `previousKnown === null` means "first load, badge nothing".
  let knownFiles = new Set<string>();
  function rebuildTree(paths: string[], previousKnown: Set<string> | null) {
    // <details> state lives in the DOM the browser owns — save which are open before replacing it.
    const openPaths = new Set([...tree.querySelectorAll<HTMLDetailsElement>("details[open]")].map((d) => d.dataset.path));
    tree.replaceChildren(buildTree(treeFrom(paths)));
    tree.querySelectorAll<HTMLDetailsElement>("details").forEach((d) => {
      if (d.dataset.path && openPaths.has(d.dataset.path)) d.open = true;
    });
    if (previousKnown) for (const path of paths) if (!previousKnown.has(path)) findFileButton(path)?.classList.add("new");
    if (selectedPath) findFileButton(selectedPath)?.classList.add("selected");
    knownFiles = new Set(paths);
  }

  // ADR 0021 decision 5: the selection lives in the URL — this is the one place that opens a file.
  function open(path: string, push: boolean) {
    content.src = `${contentOrigin}/${encodeURI(path)}`;
    moveHighlight(path);
    findFileButton(path)?.classList.remove("new");
    // Compare the encoded form — location.pathname is always encoded, `path` never is.
    if (push && `/${encodeURI(path)}` !== location.pathname) history.pushState({}, "", `/${encodeURI(path)}`);
  }

  // Load and Back/Forward both just read the URL — an empty path opens nothing (no default lesson).
  function syncFromUrl() {
    if (location.pathname === "/") {
      moveHighlight(null);
      content.removeAttribute("src");
    } else {
      open(decodeURIComponent(location.pathname.slice(1)), false);
    }
  }

  fetchFiles().then((paths) => rebuildTree(paths, null)); // nothing is "new" on first load — no badge
  syncFromUrl();
  addEventListener("popstate", syncFromUrl);

  tree.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof HTMLButtonElement && target.classList.contains("file") && target.dataset.path) open(target.dataset.path, true);
  });

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "fsevent") {
      if (selectedPath && message.path === selectedPath) {
        content.src = `${contentOrigin}/${encodeURI(selectedPath)}?v=${Date.now()}`;
      } else {
        const previousKnown = knownFiles;
        fetchFiles().then((paths) => rebuildTree(paths, previousKnown));
      }
    }
    if (message.type === "injected") {
      setStatus("synced");
      const text = pendingInjects.shift();
      if (text !== undefined) {
        sentLog.unshift(text);
        renderSentLog();
      }
    }
  };

  // Step 5/ADR 0016/0017 hardening: forward only frames genuinely from the content iframe, on its
  // real origin — the server's sanitizer/journal validator is the real defense, this closes the spoofing gap.
  addEventListener("message", (event) => {
    const frame = extractForwardFrame(event, content.contentWindow, contentOrigin);
    if (!frame || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(frame));
    // Reports are fire-and-forget by design (ADR 0017) — only injects move the status dot.
    if (frame.type === "inject") {
      pendingInjects.push(frame.text as string);
      setStatus("syncing");
    }
    // ADR 0021 decision 6: page-open tracks in-lesson navigation, behind a same-path guard —
    // that guard is what stops the tree click (open, above) and this frame from double-pushing.
    if (frame.type === "report" && frame.event === "page-open" && typeof frame.page === "string" && frame.page !== location.pathname) {
      history.pushState({}, "", frame.page);
      moveHighlight(decodeURIComponent(frame.page.slice(1)));
    }
  });

  document.getElementById("send-selection")!.addEventListener("click", () => {
    // Explicit target origin, never "*" — this page must not leak the selection to anything else.
    content.contentWindow?.postMessage({ type: "get-selection" }, contentOrigin);
  });

  document.getElementById("toggle")!.addEventListener("click", () => {
    document.getElementById("sidebar")!.classList.toggle("collapsed");
  });
}
