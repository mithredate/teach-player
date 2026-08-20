#!/usr/bin/env node
import { spawn as spawnOpener } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { spawn } from "node-pty";
import { WebSocket, WebSocketServer } from "ws";
import { createReplayBuffer } from "./replay-buffer.ts";

const PORT = 7529; // ADR 0006: spells PLAY, loopback only, no --port flag
const REPLAY_BYTES = 200 * 1024; // ADR 0003

function fail(message: string): never {
  console.error(`teach-player: ${message}`);
  process.exit(1);
}

// ADR 0007 (amended): first arg is always the workspace when present; bare launch = cwd.
const [workspaceArg = ".", ...command] = process.argv.slice(2);
const workspace = resolve(workspaceArg);
if (!statSync(workspace, { throwIfNoEntry: false })?.isDirectory())
  fail(`not a directory: ${workspace}\nusage: teach-player [workspace] [command…]  (defaults: current directory, claude)`);

// ADR 0007: everything after the workspace is the agent command, handed to the PTY verbatim.
const [agent = "claude", ...agentArgs] = command;
const pty = spawn(agent, agentArgs, {
  cwd: workspace,
  name: "xterm-256color",
  cols: 80,
  rows: 24,
  encoding: null, // raw bytes, so PTY output and WebSocket frames are the same thing
});

const replay = createReplayBuffer(REPLAY_BYTES);
let client: WebSocket | null = null;

const shell: Record<string, [file: string, mime: string] | undefined> = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/main.js": ["main.js", "text/javascript"],
  "/main.css": ["main.css", "text/css"],
};
const http = createServer((request, response) => {
  const served = shell[request.url ?? "/"];
  if (!served) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "content-type": served[1] });
  response.end(readFileSync(join(import.meta.dirname, served[0])));
});

// Registered before the WebSocketServer, which re-emits http errors as its own and would throw first.
http.on("error", (error: NodeJS.ErrnoException) =>
  fail(error.code === "EADDRINUSE" ? `port ${PORT} in use — is another teach-player running?` : error.message),
);

// Any web page can open a WebSocket to 127.0.0.1, so browser connections must prove they
// came from our own shell page; non-browser clients send no Origin and are same-user anyway.
const OK_ORIGINS = [undefined, `http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`];
const wss = new WebSocketServer({
  server: http,
  verifyClient: ({ origin }: { origin?: string }) => OK_ORIGINS.includes(origin),
});
wss.on("connection", (socket) => {
  // ADR 0002: the newest tab takes over; the previous one is told and closed.
  if (client?.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify({ type: "notice", text: "session taken over by a newer tab" }));
    client.close();
  }
  client = socket;
  socket.send(replay.replay(), { binary: true });

  socket.on("message", (data, isBinary) => {
    if (socket !== client) return;
    if (isBinary) {
      pty.write(data as Buffer);
      return;
    }
    let control;
    try {
      control = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (control?.type === "resize" && Number.isInteger(control.cols) && Number.isInteger(control.rows) && control.cols > 0 && control.rows > 0) {
      pty.resize(control.cols, control.rows);
    }
  });
  socket.on("close", () => {
    if (socket === client) client = null;
  });
});

pty.onData((chunk) => {
  // encoding:null makes node-pty emit Buffers, but its types still say string.
  replay.add(chunk as unknown as Buffer);
  if (client?.readyState === WebSocket.OPEN) client.send(chunk, { binary: true });
});

pty.onExit(({ exitCode }) => {
  const notice = JSON.stringify({ type: "notice", text: `agent exited (code ${exitCode})` });
  if (client?.readyState === WebSocket.OPEN) client.send(notice, () => process.exit(exitCode));
  else process.exit(exitCode);
});

http.listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`teach-player: ${agent} in ${workspace} — ${url}`);
  // ADR 0006: opening the browser is best-effort; headless and WSL boxes have no opener.
  spawnOpener(process.platform === "darwin" ? "open" : "xdg-open", [url], { stdio: "ignore" }).on("error", () => {});
});
