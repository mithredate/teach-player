import { test } from "node:test";
import assert from "node:assert/strict";
import { extractInjectText } from "../../src/client/main.ts";

const contentOrigin = "http://127.0.0.1:23456";
const contentWindow = { name: "the content iframe's window" }; // identity is all that matters here

test("a message from the content window, on the content origin, shaped like an inject, is forwarded", () => {
  const event = { source: contentWindow, origin: contentOrigin, data: { type: "inject", text: "hi" } };
  assert.equal(extractInjectText(event, contentWindow, contentOrigin), "hi");
});

test("a message from a different window is rejected, even with the right origin", () => {
  const impostor = { name: "not the content iframe" };
  const event = { source: impostor, origin: contentOrigin, data: { type: "inject", text: "hi" } };
  assert.equal(extractInjectText(event, contentWindow, contentOrigin), null);
});

test("a message with the right window but a foreign origin is rejected", () => {
  const event = { source: contentWindow, origin: "https://evil.example", data: { type: "inject", text: "hi" } };
  assert.equal(extractInjectText(event, contentWindow, contentOrigin), null);
});

test("a non-inject message shape is ignored", () => {
  const event = { source: contentWindow, origin: contentOrigin, data: { type: "get-selection" } };
  assert.equal(extractInjectText(event, contentWindow, contentOrigin), null);
});

test("a non-string text is ignored", () => {
  const event = { source: contentWindow, origin: contentOrigin, data: { type: "inject", text: 42 } };
  assert.equal(extractInjectText(event, contentWindow, contentOrigin), null);
});

test("empty text is ignored", () => {
  const event = { source: contentWindow, origin: contentOrigin, data: { type: "inject", text: "" } };
  assert.equal(extractInjectText(event, contentWindow, contentOrigin), null);
});
