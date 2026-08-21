import { test } from "node:test";
import assert from "node:assert/strict";
import { buildJournalEntry } from "../../src/journal.ts";

const ts = new Date("2026-08-21T12:00:00.000Z");

test("a valid report round-trips with all four fields", () => {
  const entry = buildJournalEntry({ type: "report", event: "report", page: "/quiz.html", data: { kind: "quiz-result", score: 7 } }, ts);

  assert.deepEqual(JSON.parse(entry), { ts: "2026-08-21T12:00:00.000Z", type: "report", page: "/quiz.html", data: { kind: "quiz-result", score: 7 } });
});

test("page-open and form-submit are accepted events too", () => {
  assert.ok(buildJournalEntry({ event: "page-open", page: "/a.html", data: {} }, ts));
  assert.ok(buildJournalEntry({ event: "form-submit", page: "/a.html", data: { name: "Ana" } }, ts));
});

test("a bad event name is dropped", () => {
  assert.equal(buildJournalEntry({ event: "delete-everything", page: "/a.html", data: {} }, ts), null);
});

test("data as a string is dropped", () => {
  assert.equal(buildJournalEntry({ event: "report", page: "/a.html", data: "free text" }, ts), null);
});

test("data as an array is dropped", () => {
  assert.equal(buildJournalEntry({ event: "report", page: "/a.html", data: ["a"] }, ts), null);
});

test("data as null is dropped", () => {
  assert.equal(buildJournalEntry({ event: "report", page: "/a.html", data: null }, ts), null);
});

test("a missing page is dropped", () => {
  assert.equal(buildJournalEntry({ event: "report", data: {} }, ts), null);
});

test("a frame that isn't an object is dropped", () => {
  assert.equal(buildJournalEntry("not an object", ts), null);
  assert.equal(buildJournalEntry(null, ts), null);
  assert.equal(buildJournalEntry(["a"], ts), null);
});

test("an entry over 10,000 characters is dropped", () => {
  const entry = buildJournalEntry({ event: "report", page: "/a.html", data: { blob: "a".repeat(20_000) } }, ts);

  assert.equal(entry, null);
});

// JSON.stringify escapes control characters, so a smuggled non-whitelisted character must
// instead be one JSON.stringify passes through untouched — a Unicode format character (Cf).
test("a non-whitelisted character smuggled into data (ZWJ) is dropped, not stripped", () => {
  const entry = buildJournalEntry({ event: "report", page: "/a.html", data: { note: "a‍b" } }, ts);

  assert.equal(entry, null);
});
