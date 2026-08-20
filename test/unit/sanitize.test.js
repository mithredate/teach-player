import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeInject } from "../../src/sanitize.ts";

test("control characters are stripped, the printable parts survive", () => {
  assert.equal(sanitizeInject("!evil\r\nrm -rf /"), "[lesson] !evilrm -rf /\r");
});

test("ESC is dropped from an ANSI escape sequence — the printable remainder legitimately survives", () => {
  assert.equal(sanitizeInject("\x1b[2K"), "[lesson] [2K\r");
});

test("the [lesson] prefix is unconditional, even for an empty string", () => {
  assert.equal(sanitizeInject(""), "[lesson] \r");
});

test("emoji and umlauts survive — the whitelist is Unicode-aware, not ASCII-only", () => {
  assert.equal(sanitizeInject("café 🎉"), "[lesson] café 🎉\r");
});

test("zero-width space and right-to-left override are dropped (Unicode format characters)", () => {
  assert.equal(sanitizeInject("a​b‮c"), "[lesson] abc\r");
});

test("kept text is capped at 10,000 characters", () => {
  const input = "a".repeat(20000);

  assert.equal(sanitizeInject(input), "[lesson] " + "a".repeat(10000) + "\r");
});

test("the output has exactly one trailing \\r and no other control character", () => {
  const result = sanitizeInject("hi\x00\x01\x1b\x7f\x9fthere\r\n");

  assert.equal(result, "[lesson] hithere\r");
  assert.equal(result.indexOf("\r"), result.length - 1);
  assert.equal(result.lastIndexOf("\r"), result.length - 1);
});
