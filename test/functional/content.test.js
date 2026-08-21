import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { utimesSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const serverScript = new URL("../../dist/server.js", import.meta.url).pathname;
const fakeAgent = new URL("../fixtures/fake-agent.js", import.meta.url).pathname;
const workspace = new URL("../fixtures/workspace/", import.meta.url).pathname;

async function startPlayer(t) {
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
  for (let attempt = 0; attempt < 100 && !stdout.text.includes("http://127.0.0.1:7529"); attempt++) await sleep(20);
}

// node:http's request() sends `path` on the wire untouched — unlike fetch, it never
// collapses ".." segments, so this is how a real traversal attempt reaches the server.
function get(path) {
  return new Promise((resolvePromise, reject) => {
    const req = request({ hostname: "127.0.0.1", port: 7529, path, method: "GET" }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolvePromise({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("a workspace page is served with the bridge script injected", async (t) => {
  await startPlayer(t);

  const response = await get("/workspace/mock/ut1.html");

  assert.equal(response.status, 200);
  assert.match(response.body, /<h1>Unit 1<\/h1>/);
  assert.match(response.body, /<script src="\/teach-bridge\.js"><\/script>\s*$/);
});

test("a relative asset under the workspace is served with its own mime type", async (t) => {
  await startPlayer(t);

  const response = await get("/workspace/assets/style.css?v=2"); // cache-busting query strings must not 404

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "text/css");
  assert.match(response.body, /font-family/);
});

test("a traversal attempt is rejected with the same 404 as an unknown route", async (t) => {
  await startPlayer(t);

  const response = await get("/workspace/../package.json");

  assert.equal(response.status, 404);
});

test("/api/files lists the workspace's html files, newest mtime first", async (t) => {
  const ut1 = join(workspace, "mock/ut1.html");
  const bridgeAware = join(workspace, "bridge-aware.html");
  utimesSync(ut1, new Date("2020-01-01"), new Date("2020-01-01"));
  utimesSync(bridgeAware, new Date("2020-06-01"), new Date("2020-06-01")); // touched later → newest

  await startPlayer(t);

  const response = await get("/api/files");

  assert.equal(response.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(response.body), ["bridge-aware.html", "mock/ut1.html"]);
});

test("the bridge script is served", async (t) => {
  await startPlayer(t);

  const response = await get("/teach-bridge.js");

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "text/javascript");
});
