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
socket.onmessage = (event) =>
  typeof event.data === "string"
    ? notice(JSON.parse(event.data).text)
    : terminal.write(new Uint8Array(event.data));
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
fetch("/api/files")
  .then((response) => response.json())
  .then((paths: string[]) => {
    if (paths.length === 0) {
      picker.add(new Option("no lessons yet", "", true, true));
      picker.options[0].disabled = true;
      return;
    }
    for (const path of paths) picker.add(new Option(path, path));
    content.src = `/workspace/${encodeURI(paths[0])}`;
  });
picker.addEventListener("change", () => (content.src = `/workspace/${encodeURI(picker.value)}`));
