import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const serverScript = new URL("../../dist/server.js", import.meta.url).pathname;
const fakeAgent = new URL("../fixtures/fake-agent.js", import.meta.url).pathname;
const fixtureWorkspace = new URL("../fixtures/workspace/", import.meta.url).pathname;

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
  return { player, controlUrl };
}

// The control page's "/" response string-replaces __CONTENT_ORIGIN__ with the real content
// origin — fetching it doubles as the test that the substitution happened.
async function getContentOrigin(controlUrl) {
  const html = await (await fetch(`${controlUrl}/`)).text();
  const match = html.match(/data-content-origin="(http:\/\/127\.0\.0\.1:\d+)"/);
  assert.ok(match, `content origin not found in "/" response: ${html}`);
  return match[1];
}

// node:http's request() sends `path` on the wire untouched — unlike fetch, it never
// collapses ".." segments, so this is how a real traversal attempt reaches the server.
function get(origin, path) {
  const { hostname, port } = new URL(origin);
  return new Promise((resolvePromise, reject) => {
    const req = request({ hostname, port, path, method: "GET" }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolvePromise({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("a lesson page is served with the bridge script injected", async (t) => {
  const { controlUrl } = await startPlayer(t, fixtureWorkspace);
  const contentOrigin = await getContentOrigin(controlUrl);

  const response = await get(contentOrigin, "/mock/ut1.html");

  assert.equal(response.status, 200);
  assert.match(response.body, /<h1>Unit 1<\/h1>/);
  assert.match(response.body, /<script src="\/teach-bridge\.js"><\/script>\s*$/);
});

test("a relative asset under public/ is served with its own mime type", async (t) => {
  const { controlUrl } = await startPlayer(t, fixtureWorkspace);
  const contentOrigin = await getContentOrigin(controlUrl);

  const response = await get(contentOrigin, "/assets/style.css?v=2"); // cache-busting query strings must not 404

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "text/css");
  assert.match(response.body, /font-family/);
});

test("a traversal attempt is rejected with the same 404 as an unknown route", async (t) => {
  const { controlUrl } = await startPlayer(t, fixtureWorkspace);
  const contentOrigin = await getContentOrigin(controlUrl);

  const response = await get(contentOrigin, "/../package.json");

  assert.equal(response.status, 404);
});

test("/_tp/files lists every file under public/, A→Z", async (t) => {
  const { controlUrl } = await startPlayer(t, fixtureWorkspace);

  const response = await get(controlUrl, "/_tp/files");

  assert.equal(response.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(response.body), ["assets/style.css", "bridge-aware.html", "mock/ut1.html"]);
});

test("an arbitrary control-server path serves the picker shell, and /_tp/files still returns JSON", async (t) => {
  const { controlUrl } = await startPlayer(t, fixtureWorkspace);

  const page = await get(controlUrl, "/lessons/0001.html");
  assert.equal(page.status, 200);
  assert.equal(page.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(page.headers["x-frame-options"], "DENY");

  const files = await get(controlUrl, "/_tp/files");
  assert.equal(files.headers["content-type"], "application/json");
});

test("the bridge script is served from the content origin", async (t) => {
  const { controlUrl } = await startPlayer(t, fixtureWorkspace);
  const contentOrigin = await getContentOrigin(controlUrl);

  const response = await get(contentOrigin, "/teach-bridge.js");

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "text/javascript");
});

test("public/ is auto-created in a fresh workspace", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "teach-player-"));

  await startPlayer(t, workspace);

  assert.ok(existsSync(join(workspace, "public")));
});

// ADR 0015: the load-bearing isolation property — public/ is the only reachable surface.
test("a file outside public/ is invisible to the content server and /_tp/files", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "teach-player-"));
  writeFileSync(join(workspace, "secret.md"), "do not leak me");

  const { controlUrl } = await startPlayer(t, workspace);
  const contentOrigin = await getContentOrigin(controlUrl);

  const response = await get(contentOrigin, "/secret.md");
  assert.equal(response.status, 404);

  const files = await get(controlUrl, "/_tp/files");
  assert.deepEqual(JSON.parse(files.body), []);
});

// ADR 0016: the content port is a stable hash of the workspace path, not random — a lesson's
// localStorage must survive the same workspace being replayed across restarts.
test("the content port is stable across restarts of the same workspace", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "teach-player-"));

  const first = await startPlayer(t, workspace);
  const firstOrigin = await getContentOrigin(first.controlUrl);
  first.player.kill();
  await once(first.player, "exit");

  const second = await startPlayer(t, workspace);
  const secondOrigin = await getContentOrigin(second.controlUrl);

  assert.equal(secondOrigin, firstOrigin);
});

test("a second player on the same workspace fails loudly instead of taking over", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "teach-player-"));
  await startPlayer(t, workspace); // holds the content port for the rest of this test

  const second = spawn(process.execPath, [serverScript, workspace, process.execPath, fakeAgent], {
    env: { ...process.env, PATH: "" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  second.stderr.on("data", (chunk) => (stderr += chunk.toString()));

  const [exitCode] = await once(second, "exit");

  assert.notEqual(exitCode, 0);
  assert.match(stderr, /already playing|hash collision/);
});
