import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

const terminal = new Terminal({ cursorBlink: true, fontSize: 14, theme: { background: "#1e1e1e" } });
const fit = new FitAddon();
terminal.loadAddon(fit);
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

terminal.onData((data) => socket.readyState === WebSocket.OPEN && socket.send(new TextEncoder().encode(data)));
terminal.onResize(({ cols, rows }) =>
  socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: "resize", cols, rows })),
);
addEventListener("resize", () => fit.fit());
