import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { WebSocket } from "ws";

const serverScript = new URL("../../dist/server.js", import.meta.url).pathname;
const fakeAgent = new URL("../fixtures/fake-agent.js", import.meta.url).pathname;

// A private temp workspace, not the shared fixture one — the content port is a hash of the
// workspace path (ADR 0016), so sharing it with content.test.js's concurrent process would collide.
function freshWorkspace() {
  const workspace = mkdtempSync(join(tmpdir(), "teach-player-"));
  mkdirSync(join(workspace, "public"), { recursive: true });
  writeFileSync(join(workspace, "public", "lesson.html"), "<h1>lesson</h1>");
  return workspace;
}

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

// The control page's "/" response string-replaces __CONTENT_ORIGIN__ with the real content
// origin — fetching it doubles as the test that the substitution happened.
async function getContentOrigin(controlUrl) {
  const html = await (await fetch(`${controlUrl}/`)).text();
  const match = html.match(/data-content-origin="(http:\/\/127\.0\.0\.1:\d+)"/);
  assert.ok(match, `content origin not found in "/" response: ${html}`);
  return match[1];
}

// node:http's request() lets a header override the Host node:http would otherwise derive
// from hostname/port — this is how a rebound-DNS request would actually arrive.
function get(origin, path, headers = {}) {
  const { hostname, port } = new URL(origin);
  return new Promise((resolvePromise, reject) => {
    const req = request({ hostname, port, path, method: "GET", headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolvePromise({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.end();
  });
}

// ADR 0016: a lesson page must not be able to open the control ws directly — its own origin
// isn't the picker page's, so the same whitelist that rejects "https://evil.example" must
// also reject the content origin.
test("the control ws rejects a connection whose Origin is the content origin", async (t) => {
  const controlUrl = await startPlayer(t, freshWorkspace());
  const contentOrigin = await getContentOrigin(controlUrl);

  const foreign = new WebSocket(`${controlUrl}/`, { headers: { origin: contentOrigin } });
  const [, response] = await once(foreign, "unexpected-response");

  assert.equal(response.statusCode, 401);
});

test("the control server rejects a request with a foreign Host header", async (t) => {
  const controlUrl = await startPlayer(t, freshWorkspace());

  const response = await get(controlUrl, "/", { Host: "evil.example" });

  assert.equal(response.status, 403);
});

test("the control server still serves a normal request", async (t) => {
  const controlUrl = await startPlayer(t, freshWorkspace());

  const response = await get(controlUrl, "/");

  assert.equal(response.status, 200);
});

test("the content server rejects a request with a foreign Host header", async (t) => {
  const controlUrl = await startPlayer(t, freshWorkspace());
  const contentOrigin = await getContentOrigin(controlUrl);

  const response = await get(contentOrigin, "/lesson.html", { Host: "evil.example" });

  assert.equal(response.status, 403);
});

test("the content server still serves a normal request", async (t) => {
  const controlUrl = await startPlayer(t, freshWorkspace());
  const contentOrigin = await getContentOrigin(controlUrl);

  const response = await get(contentOrigin, "/lesson.html");

  assert.equal(response.status, 200);
});

test("the picker page sets X-Frame-Options: DENY", async (t) => {
  const controlUrl = await startPlayer(t, freshWorkspace());

  const response = await get(controlUrl, "/");

  assert.equal(response.headers["x-frame-options"], "DENY");
});
