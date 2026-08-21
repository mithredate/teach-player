import { test } from "node:test";
import assert from "node:assert/strict";
import { submitToReport } from "../../src/bridge.ts";

test("string-valued fields are kept, shaped as a form-submit report", () => {
  const frame = submitToReport(
    [
      ["name", "Ana"],
      ["age", "7"],
    ],
    "quiz-form",
    "/quiz.html",
  );

  assert.deepEqual(frame, {
    type: "report",
    event: "form-submit",
    page: "/quiz.html",
    data: { form: "quiz-form", fields: { name: "Ana", age: "7" } },
  });
});

test("non-string values (e.g. a File upload) are dropped, not stringified", () => {
  const fakeFile = { name: "photo.png" }; // stand-in for a File — only its non-string-ness matters here
  const frame = submitToReport(
    [
      ["name", "Ana"],
      ["avatar", fakeFile],
    ],
    "quiz-form",
    "/quiz.html",
  );

  assert.deepEqual(frame.data.fields, { name: "Ana" });
});

test("form id and page are carried straight through, empty id when the form has none", () => {
  const frame = submitToReport([], "", "/a.html");

  assert.equal(frame.data.form, "");
  assert.equal(frame.page, "/a.html");
  assert.deepEqual(frame.data.fields, {});
});
