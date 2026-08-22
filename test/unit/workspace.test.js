import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listFiles, resolveWorkspacePath } from "../../src/workspace.ts";

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

test("listFiles sorts A→Z by full path", () => {
  const root = mkdtempSync(join(tmpdir(), "teach-player-workspace-"));
  writeFileSync(join(root, "zed.html"), "z");
  writeFileSync(join(root, "aaa.html"), "a");

  assert.deepEqual(listFiles(root), ["aaa.html", "zed.html"]);
});

test("listFiles recurses into subdirectories", () => {
  const root = mkdtempSync(join(tmpdir(), "teach-player-workspace-"));
  mkdirSync(join(root, "mock"));
  writeFileSync(join(root, "mock", "ut1.html"), "hi");

  assert.deepEqual(listFiles(root), ["mock/ut1.html"]);
});

test("listFiles skips .git", () => {
  const root = mkdtempSync(join(tmpdir(), "teach-player-workspace-"));
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "config.html"), "not a lesson");
  writeFileSync(join(root, "lesson.html"), "hi");

  assert.deepEqual(listFiles(root), ["lesson.html"]);
});

test("listFiles skips node_modules", () => {
  const root = mkdtempSync(join(tmpdir(), "teach-player-workspace-"));
  mkdirSync(join(root, "node_modules"));
  writeFileSync(join(root, "node_modules", "x.html"), "not a lesson");
  writeFileSync(join(root, "lesson.html"), "hi");

  assert.deepEqual(listFiles(root), ["lesson.html"]);
});

test("listFiles lists every file, not just .html", () => {
  const root = mkdtempSync(join(tmpdir(), "teach-player-workspace-"));
  writeFileSync(join(root, "notes.txt"), "no longer ignored");
  writeFileSync(join(root, "lesson.html"), "hi");

  assert.deepEqual(listFiles(root), ["lesson.html", "notes.txt"]);
});

test("listFiles excludes dotfile segments", () => {
  const root = mkdtempSync(join(tmpdir(), "teach-player-workspace-"));
  writeFileSync(join(root, ".env"), "secret");
  mkdirSync(join(root, ".hidden"));
  writeFileSync(join(root, ".hidden", "x.html"), "hidden");
  writeFileSync(join(root, "lesson.html"), "hi");

  assert.deepEqual(listFiles(root), ["lesson.html"]);
});

test("listFiles skips a broken symlink instead of throwing", () => {
  const root = mkdtempSync(join(tmpdir(), "teach-player-workspace-"));
  symlinkSync(join(root, "does-not-exist"), join(root, "broken.html"));
  writeFileSync(join(root, "lesson.html"), "hi");

  assert.deepEqual(listFiles(root), ["lesson.html"]);
});
