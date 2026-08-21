import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { WebSocket } from "ws";

const serverScript = new URL("../../dist/server.js", import.meta.url).pathname;
const fakeAgent = new URL("../fixtures/fake-agent.js", import.meta.url).pathname;

async function startPlayer(t, workspace) {
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
  // ADR 0016: pty output streams straight to this stdout pipe now, so it must stay open and
  // read for the player's whole life — draining it with a for-await-break would EPIPE the pty.
  const stdout = { text: "" };
  player.stdout.on("data", (chunk) => (stdout.text += chunk.toString()));
  let controlUrl;
  for (let attempt = 0; attempt < 100 && !controlUrl; attempt++) {
    controlUrl = stdout.text.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (!controlUrl) await sleep(20);
  }
  assert.ok(controlUrl, `never saw a control URL on stdout — held ${JSON.stringify(stdout.text)}`);
  return controlUrl;
}

function connect(controlUrl) {
  // ADR 0016: pty output no longer travels over ws — only fsevent/control frames do.
  const socket = new WebSocket(`${controlUrl}/`);
  const terminal = { notices: [] };
  socket.on("message", (data) => terminal.notices.push(JSON.parse(data.toString())));
  return { socket, terminal };
}

async function waitForFsevent(terminal, path) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (terminal.notices.some((frame) => frame.type === "fsevent" && frame.path === path)) return;
    await sleep(20);
  }
  assert.fail(`never saw fsevent for ${JSON.stringify(path)} — notices held ${JSON.stringify(terminal.notices)}`);
}

test("editing a workspace file reaches the client as an fsevent", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "teach-player-"));
  const controlUrl = await startPlayer(t, workspace);

  const { socket, terminal } = connect(controlUrl);
  await once(socket, "open");
  await sleep(50); // let the watcher settle before the write, so the fsevent isn't lost to a race

  // ADR 0015/0016: the watcher watches public/, not the workspace root.
  writeFileSync(join(workspace, "public", "lesson.html"), "<p>hi</p>");

  await waitForFsevent(terminal, "lesson.html");
});

test(".git changes are not broadcast", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "teach-player-"));
  mkdirSync(join(workspace, "public", ".git"), { recursive: true });
  const controlUrl = await startPlayer(t, workspace);

  const { socket, terminal } = connect(controlUrl);
  await once(socket, "open");
  await sleep(50);

  writeFileSync(join(workspace, "public", ".git", "config"), "[core]\n");
  await sleep(300);
  writeFileSync(join(workspace, "public", "visible.html"), "<p>hi</p>");

  await waitForFsevent(terminal, "visible.html");

  const fsevents = terminal.notices.filter((frame) => frame.type === "fsevent");
  assert.equal(fsevents.length, 1);
  assert.equal(fsevents[0].path, "visible.html");
});
