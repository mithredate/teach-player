import { test } from "node:test";
import assert from "node:assert/strict";
import { createReplayBuffer } from "../../src/replay-buffer.ts";

test("a fresh buffer replays nothing", () => {
  const buffer = createReplayBuffer(1024);

  assert.equal(buffer.replay().length, 0);
});

test("a buffer below its limit replays every byte in order", () => {
  const buffer = createReplayBuffer(1024);

  buffer.add(Buffer.from("hello "));
  buffer.add(Buffer.from("world"));

  assert.equal(buffer.replay().toString(), "hello world");
});

test("a buffer above its limit replays only the newest bytes", () => {
  const buffer = createReplayBuffer(5);

  buffer.add(Buffer.from("abc"));
  buffer.add(Buffer.from("defgh"));

  assert.equal(buffer.replay().toString(), "defgh");
});

test("a single chunk larger than the limit is trimmed to the newest bytes", () => {
  const buffer = createReplayBuffer(3);

  buffer.add(Buffer.from("0123456789"));

  assert.equal(buffer.replay().toString(), "789");
});
