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

async function waitForFsevent(terminal, path) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (terminal.notices.some((frame) => frame.type === "fsevent" && frame.path === path)) return;
    await sleep(20);
  }
  assert.fail(`never saw fsevent for ${JSON.stringify(path)} — notices held ${JSON.stringify(terminal.notices)}`);
}

test("editing a workspace file reaches the client as an fsevent", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "teach-player-"));
  await startPlayer(t, workspace);

  const { socket, terminal } = connect();
  await once(socket, "open");
  await sleep(50); // let the replay frame land before we start watching for the fsevent

  writeFileSync(join(workspace, "lesson.html"), "<p>hi</p>");

  await waitForFsevent(terminal, "lesson.html");
});

test(".git changes are not broadcast", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "teach-player-"));
  mkdirSync(join(workspace, ".git"));
  await startPlayer(t, workspace);

  const { socket, terminal } = connect();
  await once(socket, "open");
  await sleep(50);

  writeFileSync(join(workspace, ".git", "config"), "[core]\n");
  await sleep(300);
  writeFileSync(join(workspace, "visible.html"), "<p>hi</p>");

  await waitForFsevent(terminal, "visible.html");

  const fsevents = terminal.notices.filter((frame) => frame.type === "fsevent");
  assert.equal(fsevents.length, 1);
  assert.equal(fsevents[0].path, "visible.html");
});
