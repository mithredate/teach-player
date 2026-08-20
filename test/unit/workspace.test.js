import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listLessons, resolveWorkspacePath } from "../../src/workspace.ts";

test("a plain file resolves inside the root", () => {
  assert.equal(resolveWorkspacePath("/tmp/ws", "a.html"), "/tmp/ws/a.html");
});

test("a nested file resolves inside the root", () => {
  assert.equal(resolveWorkspacePath("/tmp/ws", "mock/ut1.html"), "/tmp/ws/mock/ut1.html");
});

test("a `..` escape is rejected", () => {
  assert.equal(resolveWorkspacePath("/tmp/ws", "../secret"), null);
});

test("a URL-encoded `..` escape is rejected", () => {
  assert.equal(resolveWorkspacePath("/tmp/ws", "%2e%2e/secret"), null);
});

test("an absolute-path trick is rejected", () => {
  assert.equal(resolveWorkspacePath("/tmp/ws", "/etc/passwd"), null);
});

test("a NUL byte is rejected", () => {
  assert.equal(resolveWorkspacePath("/tmp/ws", "a%00.html"), null);
});

test("a `.git` path segment is rejected", () => {
  assert.equal(resolveWorkspacePath("/tmp/ws", ".git/config"), null);
});

test("a `node_modules` path segment is rejected", () => {
  assert.equal(resolveWorkspacePath("/tmp/ws", "node_modules/x.html"), null);
});

test("malformed percent-encoding is rejected", () => {
  assert.equal(resolveWorkspacePath("/tmp/ws", "%"), null);
});

test("listLessons sorts by mtime, newest first", () => {
  const root = mkdtempSync(join(tmpdir(), "teach-player-workspace-"));
  writeFileSync(join(root, "oldest.html"), "old");
  writeFileSync(join(root, "newest.html"), "new");
  utimesSync(join(root, "oldest.html"), new Date("2020-01-01"), new Date("2020-01-01"));
  utimesSync(join(root, "newest.html"), new Date("2020-06-01"), new Date("2020-06-01"));

  assert.deepEqual(listLessons(root), ["newest.html", "oldest.html"]);
});

test("listLessons recurses into subdirectories", () => {
  const root = mkdtempSync(join(tmpdir(), "teach-player-workspace-"));
  mkdirSync(join(root, "mock"));
  writeFileSync(join(root, "mock", "ut1.html"), "hi");

  assert.deepEqual(listLessons(root), ["mock/ut1.html"]);
});

test("listLessons skips .git", () => {
  const root = mkdtempSync(join(tmpdir(), "teach-player-workspace-"));
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "config.html"), "not a lesson");
  writeFileSync(join(root, "lesson.html"), "hi");

  assert.deepEqual(listLessons(root), ["lesson.html"]);
});

test("listLessons skips node_modules", () => {
  const root = mkdtempSync(join(tmpdir(), "teach-player-workspace-"));
  mkdirSync(join(root, "node_modules"));
  writeFileSync(join(root, "node_modules", "x.html"), "not a lesson");
  writeFileSync(join(root, "lesson.html"), "hi");

  assert.deepEqual(listLessons(root), ["lesson.html"]);
});

test("listLessons ignores non-html files", () => {
  const root = mkdtempSync(join(tmpdir(), "teach-player-workspace-"));
  writeFileSync(join(root, "notes.txt"), "ignore me");
  writeFileSync(join(root, "lesson.html"), "hi");

  assert.deepEqual(listLessons(root), ["lesson.html"]);
});
