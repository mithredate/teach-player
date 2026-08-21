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
    // An empty PATH hides the browser opener, which ADR 0006 makes non-fatal. stdin is a
    // pipe (non-TTY) so tests can write to it, same as `script`'s non-interactive callers.
    env: { ...process.env, PATH: "" },
    stdio: ["pipe", "pipe", "inherit"],
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
  return { player, stdout };
}

async function waitForOutput(stdout, text) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (stdout.text.includes(text)) return;
    await sleep(20);
  }
  assert.fail(`never saw ${JSON.stringify(text)} on stdout — held ${JSON.stringify(stdout.text)}`);
}

test("bytes travel terminal → agent → terminal", async (t) => {
  const { player, stdout } = await startPlayer(t);
  await waitForOutput(stdout, "fake-agent ready");

  player.stdin.write("hello\r");

  await waitForOutput(stdout, "echo:hello");
});

test("the agent's exit code passes through to the player", async (t) => {
  const { player, stdout } = await startPlayer(t);
  await waitForOutput(stdout, "fake-agent ready");

  player.stdin.write("\x03"); // fake-agent exits 0 on Ctrl-C

  const [exitCode] = await once(player, "exit");
  assert.equal(exitCode, 0);
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
  const { stdout } = await startPlayer(t);
  await waitForOutput(stdout, "fake-agent ready");

  const socket = new WebSocket("ws://127.0.0.1:7529/");
  await once(socket, "open");

  socket.send("not json");
  socket.send(JSON.stringify({ type: "inject" })); // malformed: no text
  socket.send(JSON.stringify({ type: "inject", text: "alive" }));

  // pty output no longer travels over ws — the proof of life is on the player's own stdout.
  await waitForOutput(stdout, "echo:[lesson] alive");
});
