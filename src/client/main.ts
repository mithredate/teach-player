import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

const terminal = new Terminal({ cursorBlink: true, fontSize: 14, theme: { background: "#1e1e1e" } });
const fit = new FitAddon();
terminal.loadAddon(fit);
terminal.loadAddon(new ClipboardAddon()); // OSC 52: lets the agent itself write the clipboard ("text copied")
terminal.open(document.getElementById("terminal")!);
fit.fit();

const notice = (text: string) => terminal.write(`\r\n\x1b[33m[teach-player] ${text}\x1b[0m\r\n`);
const socket = new WebSocket(`ws://${location.host}/`);
socket.binaryType = "arraybuffer";

socket.onopen = () => {
  fit.fit();
  socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
};
socket.onmessage = (event) => {
  if (typeof event.data !== "string") return void terminal.write(new Uint8Array(event.data));
  const message = JSON.parse(event.data);
  if (message.type === "notice") notice(message.text);
  else if (message.type === "fsevent")
    message.path === picker.value
      ? (content.src = `/workspace/${encodeURI(picker.value)}?v=${Date.now()}`)
      : fetchFiles().then((paths) => renderPicker(paths, picker.value));
};
socket.onclose = () => notice("disconnected — reload this page to take over");

// Terminal parity: selecting copies, right-click pastes (127.0.0.1 is a secure context,
// so navigator.clipboard is available; Chrome asks once before the first clipboard read).
terminal.onSelectionChange(() => {
  const selection = terminal.getSelection();
  if (selection) navigator.clipboard.writeText(selection).catch(() => {});
});
document.getElementById("terminal")!.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  navigator.clipboard.readText().then((text) => text && terminal.paste(text), () => {});
});

terminal.onData((data) => socket.readyState === WebSocket.OPEN && socket.send(new TextEncoder().encode(data)));
terminal.onResize(({ cols, rows }) =>
  socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: "resize", cols, rows })),
);
addEventListener("resize", () => fit.fit());

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
  if (paths.length) content.src = `/workspace/${encodeURI(paths[0])}`;
});
picker.addEventListener("change", () => {
  picker.selectedOptions[0].text = picker.value; // clear the "new" badge once picked
  content.src = `/workspace/${encodeURI(picker.value)}`;
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
