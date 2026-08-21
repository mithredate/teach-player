import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { WebSocket } from "ws";

const serverScript = new URL("../../dist/server.js", import.meta.url).pathname;
const fakeAgent = new URL("../fixtures/fake-agent.js", import.meta.url).pathname;

async function startPlayer(t, workspace = mkdtempSync(join(tmpdir(), "teach-player-"))) {
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
  return { workspace, stdout, controlUrl };
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

// The control page's "/" response string-replaces __CONTENT_ORIGIN__ with the real content
// origin — fetching it doubles as reading the content origin back out.
async function getContentOrigin(controlUrl) {
  const html = await (await fetch(`${controlUrl}/`)).text();
  const match = html.match(/data-content-origin="(http:\/\/127\.0\.0\.1:\d+)"/);
  assert.ok(match, `content origin not found in "/" response: ${html}`);
  return match[1];
}

function journalPath(workspace) {
  return join(workspace, ".teach-player", "journal.jsonl");
}

async function waitForJournalLines(workspace, count) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const lines = readFileSync(journalPath(workspace), "utf8").trim().split("\n").filter(Boolean);
      if (lines.length >= count) return lines;
    } catch {
      // journal.jsonl doesn't exist yet — normal until the first accepted report
    }
    await sleep(20);
  }
  assert.fail(`journal never reached ${count} line(s)`);
}

test("a valid report round-trips into the journal", async (t) => {
  const { workspace, controlUrl } = await startPlayer(t);
  const socket = new WebSocket(`${controlUrl}/`);
  await once(socket, "open");

  socket.send(JSON.stringify({ type: "report", event: "report", page: "/quiz.html", data: { kind: "quiz-result", score: 7 } }));

  const [line] = await waitForJournalLines(workspace, 1);
  const entry = JSON.parse(line);
  assert.equal(entry.type, "report");
  assert.equal(entry.page, "/quiz.html");
  assert.deepEqual(entry.data, { kind: "quiz-result", score: 7 });
  assert.ok(!Number.isNaN(Date.parse(entry.ts)));
});

test("invalid reports are dropped silently, the session lives on", async (t) => {
  const { workspace, stdout, controlUrl } = await startPlayer(t);
  const socket = new WebSocket(`${controlUrl}/`);
  await once(socket, "open");

  socket.send(JSON.stringify({ type: "report", event: "report", page: "/a.html", data: "free text" }));
  socket.send(JSON.stringify({ type: "report", event: "report", page: "/a.html", data: ["a"] }));
  socket.send(JSON.stringify({ type: "report", event: "report", data: {} }));
  socket.send(JSON.stringify({ type: "report", event: "delete-everything", page: "/a.html", data: {} }));
  socket.send(JSON.stringify({ type: "report", event: "report", page: "/a.html", data: { ok: true } }));
  socket.send(JSON.stringify({ type: "inject", text: "still alive" }));

  await waitForOutput(stdout, "echo:[lesson] still alive");
  const lines = await waitForJournalLines(workspace, 1);
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]).data, { ok: true });
});

// ADR 0018: the skill is what makes the agent aware of teach-player — install paths, valid
// frontmatter and the load-bearing content are all asserted, for both agents.
test("a fresh workspace gets the teach-player skill installed for both agents", async (t) => {
  const { workspace } = await startPlayer(t);

  for (const agentDir of [".claude", ".agents"]) {
    const skillDir = join(workspace, agentDir, "skills", "teach-player");
    const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8");
    const [, frontmatter] = skill.split("---\n");
    assert.match(frontmatter, /^name: teach-player$/m);
    // The description is the only always-in-context part, so it carries the essentials.
    const [, description] = frontmatter.match(/^description: (.*)$/m);
    for (const essential of ["teach-player", "public/", "journal", "report", "send"]) assert.ok(description.includes(essential), `description misses ${essential}: ${description}`);
    // The agent can only interpret journal lines if the skill states the entry formats.
    assert.match(skill, /`page-open`.*\{title\}/);
    assert.match(skill, /`form-submit`.*\{form, fields\}/);

    const security = readFileSync(join(skillDir, "references", "security.md"), "utf8");
    assert.match(security, /untrusted data/);
    assert.match(security, /checklist/i);
  }

  // ADR 0018: user-owned files stay the user's — no pointer files any more.
  assert.ok(!existsSync(join(workspace, "CLAUDE.md")));
  assert.ok(!existsSync(join(workspace, "AGENTS.md")));
});

test("a restart rewrites the skill and clears the guide of older versions", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "teach-player-"));
  const skillDir = join(workspace, ".claude", "skills", "teach-player");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), "stale skill from an older player\n");
  mkdirSync(join(workspace, ".teach-player"), { recursive: true });
  writeFileSync(join(workspace, ".teach-player", "GUIDE.md"), "the ADR 0017 guide\n");
  writeFileSync(join(workspace, "CLAUDE.md"), "my rules\n");

  await startPlayer(t, workspace);

  assert.match(readFileSync(join(skillDir, "SKILL.md"), "utf8"), /^name: teach-player$/m);
  assert.ok(!existsSync(join(workspace, ".teach-player", "GUIDE.md")));
  assert.equal(readFileSync(join(workspace, "CLAUDE.md"), "utf8"), "my rules\n");
});

test("an accepted inject is acknowledged on the same socket", async (t) => {
  const { controlUrl } = await startPlayer(t);
  const socket = new WebSocket(`${controlUrl}/`);
  await once(socket, "open");

  socket.send(JSON.stringify({ type: "inject", text: "hi" }));
  const [data] = await once(socket, "message");

  assert.deepEqual(JSON.parse(data.toString()), { type: "injected" });
});

test("lesson HTML carries a frame-ancestors CSP scoped to the control port", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "teach-player-"));
  mkdirSync(join(workspace, "public"), { recursive: true });
  writeFileSync(join(workspace, "public", "lesson.html"), "<h1>lesson</h1>");

  const { controlUrl } = await startPlayer(t, workspace);
  const contentOrigin = await getContentOrigin(controlUrl);
  const controlPort = new URL(controlUrl).port;

  const response = await fetch(`${contentOrigin}/lesson.html`);

  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors/);
  assert.match(response.headers.get("content-security-policy") ?? "", new RegExp(`:${controlPort}\\b`));
});
