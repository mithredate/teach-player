import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { WebSocket } from "ws";

const serverScript = new URL("../../dist/server.js", import.meta.url).pathname;
const fakeAgent = new URL("../fixtures/fake-agent.js", import.meta.url).pathname;

async function startPlayer(t) {
  const workspace = mkdtempSync(join(tmpdir(), "teach-player-"));
  const player = spawn(process.execPath, [serverScript, workspace, process.execPath, fakeAgent], {
    // An empty PATH hides the browser opener, which ADR 0006 makes non-fatal.
    env: { ...process.env, PATH: "" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  t.after(async () => {
    player.kill();
    await once(player, "exit");
  });
  for await (const chunk of player.stdout) if (chunk.toString().includes("http://127.0.0.1:7529")) break;
}

function connect() {
  const socket = new WebSocket("ws://127.0.0.1:7529/");
  const terminal = { output: "", notices: [] };
  socket.on("message", (data, isBinary) =>
    isBinary ? (terminal.output += data.toString()) : terminal.notices.push(JSON.parse(data.toString())),
  );
  return { socket, terminal };
}

async function waitForOutput(terminal, text) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (terminal.output.includes(text)) return;
    await sleep(20);
  }
  assert.fail(`never saw ${JSON.stringify(text)} — terminal held ${JSON.stringify(terminal.output)}`);
}

test("bytes travel from the browser to the agent and back", async (t) => {
  await startPlayer(t);

  const { socket, terminal } = connect();
  await once(socket, "open");
  await waitForOutput(terminal, "fake-agent ready");

  socket.send(Buffer.from("hello\r"));

  await waitForOutput(terminal, "echo:hello");
});

test("a client that connects later gets the earlier output replayed", async (t) => {
  await startPlayer(t);

  const early = connect();
  await once(early.socket, "open");
  early.socket.send(Buffer.from("ping\r"));
  await waitForOutput(early.terminal, "echo:ping");
  early.socket.close();
  await once(early.socket, "close");

  const late = connect();
  await once(late.socket, "open");

  await waitForOutput(late.terminal, "echo:ping"); // replayed: this client typed nothing
});

test("the newest tab takes over and the old one is told and closed", async (t) => {
  await startPlayer(t);

  const old = connect();
  await once(old.socket, "open");
  await waitForOutput(old.terminal, "fake-agent ready");

  const newest = connect();
  await once(newest.socket, "open");
  await once(old.socket, "close");

  assert.deepEqual(
    old.terminal.notices.map((frame) => frame.type),
    ["notice"],
  );
  assert.match(old.terminal.notices[0].text, /taken over/);

  newest.socket.send(Buffer.from("second\r"));
  await waitForOutput(newest.terminal, "echo:second");
});

test("a web page from a foreign origin cannot connect", async (t) => {
  await startPlayer(t);

  const foreign = new WebSocket("ws://127.0.0.1:7529/", { headers: { origin: "https://evil.example" } });
  const [, response] = await once(foreign, "unexpected-response");

  assert.equal(response.statusCode, 401);

  const own = new WebSocket("ws://127.0.0.1:7529/", { headers: { origin: "http://127.0.0.1:7529" } });
  await once(own, "open");
  own.close();
});

test("garbage control frames are ignored, the session lives on", async (t) => {
  await startPlayer(t);

  const { socket, terminal } = connect();
  await once(socket, "open");
  await waitForOutput(terminal, "fake-agent ready");

  socket.send("not json");
  socket.send(JSON.stringify({ type: "resize", cols: -1, rows: "huge" }));
  socket.send(Buffer.from("alive\r"));

  await waitForOutput(terminal, "echo:alive");
});
