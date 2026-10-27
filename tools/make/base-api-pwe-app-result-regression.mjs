import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const source = "/workspace/api/src/artifacts/write-intent-app-route.ts";
const original = readFileSync(source);
const before = readFileSync("/workspace/tools/make/base-api-pwe-before-app-result.txt");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
assert.equal(sha(before), "30d89c10572589abddca1dcf75935086e78e992573f008266f6e6453b003a018");
assert.notEqual(sha(original), sha(before), "Before/after source bytes must differ");
function run(phase, failed) {
  const prefix = `/evidence/app-result-${phase}`;
  const result = spawnSync("../node_modules/.bin/vitest", ["run", "--config", "vitest.isolated.config.ts",
    "tests/integration/pwe-app-receipt.spec.ts", "--reporter=json", `--outputFile.json=${prefix}.json`],
  { cwd: "/workspace/api", encoding: "utf8", timeout: 60_000 });
  writeFileSync(`${prefix}.log`, (result.stdout ?? "") + (result.stderr ?? ""));
  assert.ifError(result.error); assert.equal(result.signal, null);
  assert.equal(result.status, failed ? 1 : 0);
  const report = JSON.parse(readFileSync(`${prefix}.json`, "utf8"));
  const cases = report.testResults.flatMap((suite) => suite.assertionResults ?? []);
  assert.equal(cases.length, 5); assert.equal(report.numPendingTests, 0);
  assert.ok(cases.every((test) => test.status === (failed ? "failed" : "passed")));
  if (failed) assert.ok(cases.every((test) => test.failureMessages.some((message) =>
    /AssertionError/.test(message) && /"(?:receipt|commandId)"/.test(message))), "Require missing-receipt assertions");
  else assert.equal(report.success, true);
  return cases.map(({ fullName, status }) => ({ fullName, status }));
}
let negative;
try { writeFileSync(source, before); negative = run("before", true); }
finally { writeFileSync(source, original); }
const positive = run("after", false);
assert.equal(sha(readFileSync(source)), sha(original));
writeFileSync("/evidence/app-result-regression.json", JSON.stringify({
  beforeCommit: "50a90b89bcdc67d1a733e1faac8795274dacc75f", beforeSha256: sha(before), restoredSha256: sha(original), negative, positive,
}, null, 2));
console.log("App result regression: 5 targeted before-fix failures; 5 restored passes; identical restored bytes");
