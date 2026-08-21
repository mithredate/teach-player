import test from "node:test";
import assert from "node:assert/strict";
import { spawn as spawnProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { spawn as spawnPty } from "node-pty";

const serverScript = new URL("../../dist/server.js", import.meta.url).pathname;
const fakeAgent = new URL("../fixtures/fake-agent.js", import.meta.url).pathname;
const playerArgs = (workspace) => [serverScript, workspace, process.execPath, fakeAgent];

function freshWorkspace(t) {
  const workspace = mkdtempSync(join(tmpdir(), "teach-player-gate-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  return workspace;
}

// ADR 0019: the gate blocks before the PTY, so only a real terminal sees the prompt. node-pty is
// already a dependency — a pty is the honest way to test a TTY-only code path.
function startOnPty(t, workspace) {
  const player = spawnPty(process.execPath, playerArgs(workspace), { cwd: workspace, name: "xterm-256color", cols: 100, rows: 30 });
  const output = { text: "", exitCode: null };
  player.onData((chunk) => (output.text += chunk));
  player.onExit(({ exitCode }) => (output.exitCode = exitCode));
  t.after(() => {
    if (output.exitCode === null) player.kill();
  });
  return { player, output };
}

// Piped stdin, like CI or `npx … | …`: non-TTY, so the gate has nobody to ask.
function startWithPipedStdin(t, workspace) {
  const player = spawnProcess(process.execPath, playerArgs(workspace), {
    env: { ...process.env, PATH: "" }, // hides the browser opener (ADR 0006 makes it non-fatal)
    stdio: ["ignore", "pipe", "inherit"],
  });
  const output = { text: "", exitCode: null };
  player.stdout.on("data", (chunk) => (output.text += chunk.toString()));
  player.on("exit", (code) => (output.exitCode = code));
  t.after(async () => {
    if (player.exitCode === null && player.signalCode === null) {
      player.kill();
      await once(player, "exit");
    }
  });
  return { player, output };
}

async function waitFor(output, text) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (output.text.includes(text)) return;
    await sleep(20);
  }
  assert.fail(`never saw ${JSON.stringify(text)} — held ${JSON.stringify(output.text)}`);
}

async function waitForExit(output) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (output.exitCode !== null) return output.exitCode;
    await sleep(20);
  }
  assert.fail(`never exited — held ${JSON.stringify(output.text)}`);
}

test("a fresh workspace lists every path it would write and prepares on Enter", async (t) => {
  const workspace = freshWorkspace(t);
  const { player, output } = startOnPty(t, workspace);

  await waitFor(output, "Continue? [Y/n]");
  for (const path of ["public/", ".teach-player/", ".claude/skills/teach-player/", ".agents/skills/teach-player/"]) assert.match(output.text, new RegExp(path.replace(/\./g, "\\.")));
  // The screen must answer "what happens to these files?" and "which agent starts?" on its own.
  assert.match(output.text, /rewritten on every run/);
  assert.match(output.text, /TEACH_PLAYER_AGENT/);
  assert.equal(existsSync(join(workspace, "public")), false, "nothing may be written before the answer");

  player.write("\r"); // plain Enter takes the default
  await waitFor(output, "http://127.0.0.1:");
  assert.ok(existsSync(join(workspace, "public")));
  assert.ok(existsSync(join(workspace, ".claude", "skills", "teach-player", "SKILL.md")));
  assert.ok(existsSync(join(workspace, ".agents", "skills", "teach-player", "SKILL.md")));
});

test("declining writes nothing, says why, and exits 0", async (t) => {
  const workspace = freshWorkspace(t);
  const { player, output } = startOnPty(t, workspace);

  await waitFor(output, "Continue? [Y/n]");
  player.write("n\r");

  assert.equal(await waitForExit(output), 0);
  assert.match(output.text, /Nothing written/);
  assert.match(output.text, /does not know the lesson format/);
  assert.deepEqual(readdirSync(workspace), []);
});

test("a prepared workspace starts straight into the agent, with no gate", async (t) => {
  const workspace = freshWorkspace(t);
  const first = startWithPipedStdin(t, workspace);
  await waitFor(first.output, "http://127.0.0.1:");
  first.player.kill();
  await once(first.player, "exit");

  const second = startWithPipedStdin(t, workspace);
  await waitFor(second.output, "http://127.0.0.1:");
  assert.doesNotMatch(second.output.text, /It will create/);
});

// ADR 0019: the path set is the state, so only what is actually missing is listed — that is also
// how a future release that adds a path shows just the new one.
test("the gate lists only the paths that are missing", async (t) => {
  const workspace = freshWorkspace(t);
  const first = startWithPipedStdin(t, workspace);
  await waitFor(first.output, "http://127.0.0.1:");
  first.player.kill();
  await once(first.player, "exit");
  rmSync(join(workspace, "public"), { recursive: true });

  const second = startWithPipedStdin(t, workspace);
  await waitFor(second.output, "http://127.0.0.1:");
  assert.match(second.output.text, /public\//);
  assert.doesNotMatch(second.output.text, /skills/);
});

test("non-TTY stdin skips the prompt and prepares anyway", async (t) => {
  const workspace = freshWorkspace(t);
  const { output } = startWithPipedStdin(t, workspace);

  await waitFor(output, "http://127.0.0.1:");
  assert.match(output.text, /It will create/);
  assert.doesNotMatch(output.text, /Continue\?/);
  assert.ok(existsSync(join(workspace, ".teach-player")));
});
