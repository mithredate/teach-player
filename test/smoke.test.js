import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("manifest invariants hold", () => {
  assert.equal(pkg.bin["teach-player"], "dist/server.js");
  assert.equal(pkg.engines.node, ">=22");
  for (const version of Object.values({ ...pkg.dependencies, ...pkg.devDependencies })) {
    assert.match(version, /^\d/, `dependency versions must be exact pins, got ${version}`);
  }
});
