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
  // ADR 0016: the control port is ephemeral now — read it back off the printed startup line.
  const [controlUrl] = await waitForMatch(stdout, /http:\/\/127\.0\.0\.1:\d+/);
  return { stdout, controlUrl };
}

async function waitForOutput(stdout, text) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (stdout.text.includes(text)) return;
    await sleep(20);
  }
  assert.fail(`never saw ${JSON.stringify(text)} on stdout — held ${JSON.stringify(stdout.text)}`);
}

async function waitForMatch(stdout, regex) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const match = stdout.text.match(regex);
    if (match) return match;
    await sleep(20);
  }
  assert.fail(`never matched ${regex} on stdout — held ${JSON.stringify(stdout.text)}`);
}

test("an inject frame reaches the agent sanitized and prefixed", async (t) => {
  const { stdout, controlUrl } = await startPlayer(t);
  await waitForOutput(stdout, "fake-agent ready");

  const socket = new WebSocket(`${controlUrl}/`);
  await once(socket, "open");

  socket.send(JSON.stringify({ type: "inject", text: "!evil\r\ninjected" }));

  // The fake agent echoes its stdin minus CR/LF: the CR/LF the attacker sent never
  // reached the PTY as control bytes — they were stripped before pty.write, not by the echo.
  await waitForOutput(stdout, "echo:[lesson] !evilinjected");
});

test("malformed inject frames are ignored, the session lives on", async (t) => {
  const { stdout, controlUrl } = await startPlayer(t);
  await waitForOutput(stdout, "fake-agent ready");

  const socket = new WebSocket(`${controlUrl}/`);
  await once(socket, "open");

  socket.send(JSON.stringify({ type: "inject" }));
  socket.send(JSON.stringify({ type: "inject", text: 42 }));
  socket.send(JSON.stringify({ type: "inject", text: "alive" }));

  await waitForOutput(stdout, "echo:[lesson] alive");
});
