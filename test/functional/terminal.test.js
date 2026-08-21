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
  // ADR 0016: the control port is ephemeral now — read it back off the printed startup line.
  const [controlUrl] = await waitForMatch(stdout, /http:\/\/127\.0\.0\.1:\d+/);
  return { player, stdout, controlUrl };
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
  const { controlUrl } = await startPlayer(t);

  const foreign = new WebSocket(`${controlUrl}/`, { headers: { origin: "https://evil.example" } });
  const [, response] = await once(foreign, "unexpected-response");

  assert.equal(response.statusCode, 401);

  const own = new WebSocket(`${controlUrl}/`, { headers: { origin: controlUrl } });
  await once(own, "open");
  own.close();
});

test("garbage control frames are ignored, the session lives on", async (t) => {
  const { stdout, controlUrl } = await startPlayer(t);
  await waitForOutput(stdout, "fake-agent ready");

  const socket = new WebSocket(`${controlUrl}/`);
  await once(socket, "open");

  socket.send("not json");
  socket.send(JSON.stringify({ type: "inject" })); // malformed: no text
  socket.send(JSON.stringify({ type: "inject", text: "alive" }));

  // pty output no longer travels over ws — the proof of life is on the player's own stdout.
  await waitForOutput(stdout, "echo:[lesson] alive");
});

test("an invalid workspace path fails with a clear message", async (t) => {
  const player = spawn(process.execPath, [serverScript, "/definitely/not/a/real/workspace"], {
    env: { ...process.env, PATH: "" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  t.after(async () => {
    if (player.exitCode === null && player.signalCode === null) {
      player.kill();
      await once(player, "exit");
    }
  });
  let stderr = "";
  player.stderr.on("data", (chunk) => (stderr += chunk.toString()));
  const [exitCode] = await once(player, "exit");

  assert.notEqual(exitCode, 0);
  assert.match(stderr, /teach-player: not a directory: \/definitely\/not\/a\/real\/workspace/);
  assert.match(stderr, /usage: teach-player/);
});

test("a nonexistent agent command fails with a clear message", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "teach-player-"));
  const player = spawn(process.execPath, [serverScript, workspace, "definitely-not-a-command"], {
    env: { ...process.env, PATH: "" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  t.after(async () => {
    if (player.exitCode === null && player.signalCode === null) {
      player.kill();
      await once(player, "exit");
    }
  });
  let stderr = "";
  player.stderr.on("data", (chunk) => (stderr += chunk.toString()));
  const [exitCode] = await once(player, "exit");

  // node-pty itself exits the pty silently for a typo'd command — the PATH precheck in
  // server.ts is what turns that into a message instead of a mute exit 1.
  assert.notEqual(exitCode, 0);
  assert.match(stderr, /teach-player: command not found: definitely-not-a-command/);
});
