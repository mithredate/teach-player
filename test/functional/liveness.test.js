import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const serverScript = new URL("../../dist/server.js", import.meta.url).pathname;
// Absolute path bypasses the PATH search in server.ts's "command not found" precheck, so PATH
// can stay empty below — same trick the other functional tests use to hide the browser opener.
const printenv = "/usr/bin/printenv";

async function waitFor(stdout, text) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (stdout.text.includes(text)) return;
    await sleep(20);
  }
  assert.fail(`never saw ${JSON.stringify(text)} on stdout — held ${JSON.stringify(stdout.text)}`);
}

// ADR 0020: the wrapper passes TEACH_PLAYER_URL into the PTY child, and only after the control
// server is actually listening — printenv proves both facts at once. An unset var prints nothing
// and exits 1, so this would fail loudly on either regression.
test("the agent command inherits TEACH_PLAYER_URL, set to the bound control port", async (t) => {
  assert.ok(existsSync(printenv), "this test needs /usr/bin/printenv");
  const workspace = mkdtempSync(join(tmpdir(), "teach-player-liveness-"));
  // Strip any outer TEACH_PLAYER_URL — running this suite inside a teach-player session would
  // otherwise leak it into the child and mask a wrapper that stopped setting it.
  const { TEACH_PLAYER_URL: _outer, ...cleanEnv } = process.env;
  const player = spawn(process.execPath, [serverScript, workspace, printenv, "TEACH_PLAYER_URL"], {
    // Empty PATH hides the browser opener (ADR 0006 makes it non-fatal); non-TTY stdin
    // auto-accepts the ADR 0019 gate for this fresh workspace.
    env: { ...cleanEnv, PATH: "" },
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

  const [exitCode] = await once(player, "exit");

  await waitFor(stdout, "http://127.0.0.1:");
  assert.match(stdout.text, /http:\/\/127\.0\.0\.1:\d+/);
  assert.equal(exitCode, 0, `printenv exits non-zero when the variable is unset — held ${JSON.stringify(stdout.text)}`);
});
