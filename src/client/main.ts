// ADR 0016: the terminal moved to the real one via PTY passthrough — this page is only
// the content pane now. The ws connection carries fsevent frames in and inject frames out.
const socket = new WebSocket(`ws://${location.host}/`);

// ADR 0015: the pane lives on its own origin — the control server string-replaced this at serve time.
const contentOrigin = document.body.dataset.contentOrigin!;

socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.type === "fsevent")
    message.path === picker.value
      ? (content.src = `${contentOrigin}/${encodeURI(picker.value)}?v=${Date.now()}`)
      : fetchFiles().then((paths) => renderPicker(paths, picker.value));
};

// Step 3: content pane — picker lists workspace lessons, newest first; iframe shows the pick.
const picker = document.getElementById("picker") as HTMLSelectElement;
const content = document.getElementById("content") as HTMLIFrameElement;

const fetchFiles = (): Promise<string[]> => fetch("/api/files").then((response) => response.json());

// Step 4: rebuilding on an fsevent needs to know which paths were already listed, to badge only the new one.
let knownFiles = new Set<string>();
function renderPicker(paths: string[], selected: string) {
  picker.replaceChildren();
  if (paths.length === 0) {
    picker.add(new Option("no lessons yet", "", true, true));
    picker.options[0].disabled = true;
  } else {
    paths.forEach((path, i) => picker.add(new Option(i === 0 && !knownFiles.has(path) ? `● ${path}` : path, path)));
    picker.value = selected;
  }
  knownFiles = new Set(paths);
}

fetchFiles().then((paths) => {
  knownFiles = new Set(paths); // nothing is "new" on first load — no badge
  renderPicker(paths, paths[0] ?? "");
  if (paths.length) content.src = `${contentOrigin}/${encodeURI(paths[0])}`;
});
picker.addEventListener("change", () => {
  picker.selectedOptions[0].text = picker.value; // clear the "new" badge once picked
  content.src = `${contentOrigin}/${encodeURI(picker.value)}`;
});

// Step 5: the bridge (ADR 0005). Only messages from the content iframe, shaped like an
// inject, are forwarded — the server's sanitizer is the real defense, this is tidiness.
addEventListener("message", (event) => {
  if (event.source !== content.contentWindow) return;
  const { type, text } = event.data ?? {};
  if (type === "inject" && typeof text === "string" && text && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "inject", text }));
  }
});

document.getElementById("send-selection")!.addEventListener("click", () => {
  content.contentWindow?.postMessage({ type: "get-selection" }, "*");
});
