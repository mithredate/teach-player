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

test("an inject frame reaches the agent sanitized and prefixed", async (t) => {
  await startPlayer(t);

  const { socket, terminal } = connect();
  await once(socket, "open");
  await waitForOutput(terminal, "fake-agent ready");

  socket.send(JSON.stringify({ type: "inject", text: "!evil\r\ninjected" }));

  // The fake agent echoes its stdin minus CR/LF: the CR/LF the attacker sent never
  // reached the PTY as control bytes — they were stripped before pty.write, not by the echo.
  await waitForOutput(terminal, "echo:[lesson] !evilinjected");
});

test("malformed inject frames are ignored, the session lives on", async (t) => {
  await startPlayer(t);

  const { socket, terminal } = connect();
  await once(socket, "open");
  await waitForOutput(terminal, "fake-agent ready");

  socket.send(JSON.stringify({ type: "inject" }));
  socket.send(JSON.stringify({ type: "inject", text: 42 }));
  socket.send(Buffer.from("alive\r"));

  await waitForOutput(terminal, "echo:alive");
});
