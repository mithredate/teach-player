import { test } from "node:test";
import assert from "node:assert/strict";
import { extractForwardFrame, treeFrom } from "../../src/client/main.ts";

const contentOrigin = "http://127.0.0.1:23456";
const contentWindow = { name: "the content iframe's window" }; // identity is all that matters here

test("a message from the content window, on the content origin, shaped like an inject, is forwarded", () => {
  const event = { source: contentWindow, origin: contentOrigin, data: { type: "inject", text: "hi" } };
  assert.deepEqual(extractForwardFrame(event, contentWindow, contentOrigin), { type: "inject", text: "hi" });
});

test("a message from a different window is rejected, even with the right origin", () => {
  const impostor = { name: "not the content iframe" };
  const event = { source: impostor, origin: contentOrigin, data: { type: "inject", text: "hi" } };
  assert.equal(extractForwardFrame(event, contentWindow, contentOrigin), null);
});

test("a message with the right window but a foreign origin is rejected", () => {
  const event = { source: contentWindow, origin: "https://evil.example", data: { type: "inject", text: "hi" } };
  assert.equal(extractForwardFrame(event, contentWindow, contentOrigin), null);
});

test("a non-string text is ignored", () => {
  const event = { source: contentWindow, origin: contentOrigin, data: { type: "inject", text: 42 } };
  assert.equal(extractForwardFrame(event, contentWindow, contentOrigin), null);
});

test("empty text is ignored", () => {
  const event = { source: contentWindow, origin: contentOrigin, data: { type: "inject", text: "" } };
  assert.equal(extractForwardFrame(event, contentWindow, contentOrigin), null);
});

test("a report from the content window, on the content origin, is forwarded whole", () => {
  const data = { type: "report", event: "page-open", page: "/a.html", data: { title: "A" } };
  const event = { source: contentWindow, origin: contentOrigin, data };
  assert.deepEqual(extractForwardFrame(event, contentWindow, contentOrigin), data);
});

test("a report from a different window is rejected, even with the right origin", () => {
  const impostor = { name: "not the content iframe" };
  const data = { type: "report", event: "report", page: "/a.html", data: {} };
  const event = { source: impostor, origin: contentOrigin, data };
  assert.equal(extractForwardFrame(event, contentWindow, contentOrigin), null);
});

test("a report with the right window but a foreign origin is rejected", () => {
  const data = { type: "report", event: "report", page: "/a.html", data: {} };
  const event = { source: contentWindow, origin: "https://evil.example", data };
  assert.equal(extractForwardFrame(event, contentWindow, contentOrigin), null);
});

test("an unknown message type is rejected", () => {
  const event = { source: contentWindow, origin: contentOrigin, data: { type: "get-selection" } };
  assert.equal(extractForwardFrame(event, contentWindow, contentOrigin), null);
});

// ADR 0021 decision 3: the input is A→Z by full path, which is NOT the ordering a tree needs —
// each level gets its own folders-first-then-A→Z pass.

test("a flat list of root files nests into a single level, A→Z", () => {
  assert.deepEqual(treeFrom(["b.html", "a.html"]), [
    { name: "a.html", path: "a.html" },
    { name: "b.html", path: "b.html" },
  ]);
});

test("a single root-level file", () => {
  assert.deepEqual(treeFrom(["readme.md"]), [{ name: "readme.md", path: "readme.md" }]);
});

test("folders sort before files at the same level, regardless of name", () => {
  assert.deepEqual(treeFrom(["z.html", "a/b.html"]), [
    { name: "a", path: "a", children: [{ name: "b.html", path: "a/b.html" }] },
    { name: "z.html", path: "z.html" },
  ]);
});

test("each level sorts A→Z independently of the others", () => {
  const tree = treeFrom(["b/2.html", "b/1.html", "a/2.html", "a/1.html"]);
  assert.deepEqual(tree, [
    {
      name: "a",
      path: "a",
      children: [
        { name: "1.html", path: "a/1.html" },
        { name: "2.html", path: "a/2.html" },
      ],
    },
    {
      name: "b",
      path: "b",
      children: [
        { name: "1.html", path: "b/1.html" },
        { name: "2.html", path: "b/2.html" },
      ],
    },
  ]);
});

test("a deeply nested path builds one folder chain, not a flat entry", () => {
  assert.deepEqual(treeFrom(["a/b/c/d.html"]), [
    {
      name: "a",
      path: "a",
      children: [
        {
          name: "b",
          path: "a/b",
          children: [
            {
              name: "c",
              path: "a/b/c",
              children: [{ name: "d.html", path: "a/b/c/d.html" }],
            },
          ],
        },
      ],
    },
  ]);
});

test("a folder that also has files nests them after its subfolders, each group A→Z", () => {
  const tree = treeFrom(["assets/z.png", "assets/sub/a.png", "assets/a.png"]);
  assert.deepEqual(tree, [
    {
      name: "assets",
      path: "assets",
      children: [
        { name: "sub", path: "assets/sub", children: [{ name: "a.png", path: "assets/sub/a.png" }] },
        { name: "a.png", path: "assets/a.png" },
        { name: "z.png", path: "assets/z.png" },
      ],
    },
  ]);
});
