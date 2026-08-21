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
    if (player.exitCode === null && player.signalCode === null) {
      player.kill();
      await once(player, "exit");
    }
  });
  const stdout = { text: "" };
  player.stdout.on("data", (chunk) => (stdout.text += chunk.toString()));
  await waitForOutput(stdout, "http://127.0.0.1:7529");
  return { stdout };
}

async function waitForOutput(stdout, text) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (stdout.text.includes(text)) return;
    await sleep(20);
  }
  assert.fail(`never saw ${JSON.stringify(text)} on stdout — held ${JSON.stringify(stdout.text)}`);
}

test("an inject frame reaches the agent sanitized and prefixed", async (t) => {
  const { stdout } = await startPlayer(t);
  await waitForOutput(stdout, "fake-agent ready");

  const socket = new WebSocket("ws://127.0.0.1:7529/");
  await once(socket, "open");

  socket.send(JSON.stringify({ type: "inject", text: "!evil\r\ninjected" }));

  // The fake agent echoes its stdin minus CR/LF: the CR/LF the attacker sent never
  // reached the PTY as control bytes — they were stripped before pty.write, not by the echo.
  await waitForOutput(stdout, "echo:[lesson] !evilinjected");
});

test("malformed inject frames are ignored, the session lives on", async (t) => {
  const { stdout } = await startPlayer(t);
  await waitForOutput(stdout, "fake-agent ready");

  const socket = new WebSocket("ws://127.0.0.1:7529/");
  await once(socket, "open");

  socket.send(JSON.stringify({ type: "inject" }));
  socket.send(JSON.stringify({ type: "inject", text: 42 }));
  socket.send(JSON.stringify({ type: "inject", text: "alive" }));

  await waitForOutput(stdout, "echo:[lesson] alive");
});
