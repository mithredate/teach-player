#!/usr/bin/env node
import { spawn as spawnOpener } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, watch } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { spawn } from "node-pty";
import { WebSocket, WebSocketServer } from "ws";
import { sanitizeInject } from "./sanitize.ts";
import { listLessons, resolveWorkspacePath } from "./workspace.ts";

function fail(message: string): never {
  console.error(`teach-player: ${message}`);
  process.exit(1);
}

// ADR 0007 (amended): first arg is always the workspace when present; bare launch = cwd.
const [workspaceArg = ".", ...command] = process.argv.slice(2);
const workspace = resolve(workspaceArg);
if (!statSync(workspace, { throwIfNoEntry: false })?.isDirectory())
  fail(`not a directory: ${workspace}\nusage: teach-player [workspace] [command…]  (defaults: current directory, claude)`);

// ADR 0015/0016: the pane is scoped to public/ only — everything else in the workspace is
// unreachable from lesson JS. A fresh workspace has no public/ yet — that's normal, not an error.
const publicDir = join(workspace, "public");
mkdirSync(publicDir, { recursive: true });

// ADR 0016: a stable hash of the workspace path, not a random or fixed port — same workspace
// always gets the same content origin, so a lesson's localStorage survives across restarts.
const contentPort = (createHash("sha256").update(workspace).digest().readUInt32BE(0) % 10000) + 20000;
const contentOrigin = `http://127.0.0.1:${contentPort}`;

// ADR 0007: everything after the workspace is the agent command, handed to the PTY verbatim.
const [agent = "claude", ...agentArgs] = command;
const pty = spawn(agent, agentArgs, {
  cwd: workspace,
  name: "xterm-256color",
  cols: process.stdout.columns || 80,
  rows: process.stdout.rows || 24,
  encoding: null, // raw bytes straight to process.stdout, no re-encoding round trip
});

// ADR 0016: the agent runs in the user's real terminal, like `script` — raw stdin in, pty
// output straight to stdout. Tests pipe a non-TTY stdin; isTTY guards setRawMode for them.
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on("data", (chunk) => pty.write(chunk));

process.stdout.on("resize", () => pty.resize(process.stdout.columns || 80, process.stdout.rows || 24));

pty.onData((chunk) => process.stdout.write(chunk as unknown as Buffer)); // encoding:null → Buffer, despite the string type

pty.onExit(({ exitCode }) => {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.exit(exitCode);
});

// ADR 0015: content server — serves ONLY public/, on its own origin, so a malicious lesson's
// fetch() can't reach the rest of the workspace. Extension whitelist only — anything else 404s.
const CONTENT_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
  ".wasm": "application/wasm",
  ".map": "application/json",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain",
  ".xml": "application/xml",
};

const contentHttp = createServer((request, response) => {
  const url = (request.url ?? "/").split("?")[0]; // lessons may cache-bust assets (style.css?v=2)

  // Ships next to server.js, not under public/ — the injection target, not lesson content.
  if (url === "/teach-bridge.js") {
    response.writeHead(200, { "content-type": "text/javascript" });
    response.end(readFileSync(join(import.meta.dirname, "teach-bridge.js")));
    return;
  }

  // "/" has no file behind it — the picker always requests a concrete path under public/.
  const resolved = url === "/" ? null : resolveWorkspacePath(publicDir, url.slice(1));
  if (!resolved) {
    response.writeHead(404).end(); // same 404 as an unknown route — don't leak why
    return;
  }
  let body: Buffer;
  try {
    body = readFileSync(resolved);
  } catch {
    response.writeHead(404).end();
    return;
  }
  const ext = extname(resolved).toLowerCase();
  // ADR 0005: the server injects the bridge into every HTML page it serves.
  const html = ext === ".html" || ext === ".htm";
  response.writeHead(200, { "content-type": CONTENT_MIME[ext] ?? "application/octet-stream" });
  response.end(html ? Buffer.concat([body, Buffer.from('<script src="/teach-bridge.js"></script>')]) : body);
});

// The hash port can't collide by chance across unrelated workspaces often, but it can: say so.
contentHttp.on("error", (error: NodeJS.ErrnoException) =>
  fail(
    error.code === "EADDRINUSE"
      ? `content port ${contentPort} in use — another teach-player may already be playing ${workspace}, or this is a rare hash collision with a different workspace`
      : error.message,
  ),
);

// Control server — the picker shell, /api/files, and the ws. Never serves anything from the
// workspace itself. Ephemeral port: no fixed 7529 left to collide with another teach-player.
const controlHttp = createServer((request, response) => {
  const url = (request.url ?? "/").split("?")[0];

  if (url === "/api/files") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(listLessons(publicDir)));
    return;
  }

  if (url === "/") {
    // Ponytail: static index.html, one placeholder string-replaced with the real content origin.
    const html = readFileSync(join(import.meta.dirname, "index.html"), "utf8").replace("__CONTENT_ORIGIN__", contentOrigin);
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
    return;
  }

  if (url === "/main.js") {
    response.writeHead(200, { "content-type": "text/javascript" });
    response.end(readFileSync(join(import.meta.dirname, "main.js")));
    return;
  }

  response.writeHead(404).end();
});

// Registered before the WebSocketServer, which re-emits http errors as its own and would throw
// first. Port 0 can't collide — any error here is unexpected, so pass the message straight through.
controlHttp.on("error", (error: NodeJS.ErrnoException) => fail(error.message));

// Any web page can open a WebSocket to 127.0.0.1, so browser connections must prove they came
// from our own shell page; non-browser clients send no Origin and are same-user anyway. The
// port is ephemeral, so the whitelist is empty until listen() below reports the port actually bound.
let okOrigins: (string | undefined)[] = [];
const wss = new WebSocketServer({
  server: controlHttp,
  verifyClient: ({ origin }: { origin?: string }) => okOrigins.includes(origin),
});
// ADR 0016: no takeover — any number of tabs can watch and inject at once.
const clients = new Set<WebSocket>();
wss.on("connection", (socket) => {
  clients.add(socket);
  socket.on("message", (data, isBinary) => {
    if (isBinary) return; // pty output no longer travels over ws — nothing to do with binary frames
    let control;
    try {
      control = JSON.parse(data.toString());
    } catch {
      return;
    }
    // ADR 0005/0001: straight to the PTY, no confirmation, no rate limit — sanitizeInject is the guard.
    if (control?.type === "inject" && typeof control.text === "string") {
      pty.write(sanitizeInject(control.text));
    }
  });
  socket.on("close", () => clients.delete(socket));
});

// Step 4: watch public/ (it exists after the mkdir above) so the browser can react to lesson
// edits. Node >=22: recursive works on every platform, so no chokidar. Debounced per burst.
const pendingPaths = new Set<string>();
let flush: NodeJS.Timeout | null = null;
watch(publicDir, { recursive: true }, (_event, filename) => {
  if (!filename) return;
  const path = filename.split(sep).join("/");
  if (path.split("/").some((segment) => segment === ".git" || segment === "node_modules")) return;
  pendingPaths.add(path);
  flush ??= setTimeout(() => {
    flush = null;
    for (const path of pendingPaths)
      for (const socket of clients) if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "fsevent", path }));
    pendingPaths.clear();
  }, 100);
});

// Print + auto-open only once both origins are actually live — the URL printed must be real.
let controlPort = 0;
let listening = 0;
function announceWhenBothReady() {
  if (++listening < 2) return;
  const url = `http://127.0.0.1:${controlPort}`;
  console.log(`teach-player: ${agent} in ${workspace} — ${url}`);
  // ADR 0006: opening the browser is best-effort; headless and WSL boxes have no opener.
  spawnOpener(process.platform === "darwin" ? "open" : "xdg-open", [url], { stdio: "ignore" }).on("error", () => {});
}

contentHttp.listen(contentPort, "127.0.0.1", announceWhenBothReady);
controlHttp.listen(0, "127.0.0.1", () => {
  controlPort = (controlHttp.address() as { port: number }).port;
  okOrigins = [undefined, `http://127.0.0.1:${controlPort}`, `http://localhost:${controlPort}`];
  announceWhenBothReady();
});
