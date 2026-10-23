import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const expected = ["artifacts-reader-connected.spec.ts", "artifacts-reader-cutoff.spec.ts"];
const present = readdirSync("api/tests/e2e").filter(name => /^artifacts-reader.*\.spec\.ts$/.test(name)).sort();
assert.deepEqual(present, expected, "required H5 browser files must exist");

let failure;
try {
  const files = execFileSync("npm", ["exec", "--workspace=api", "--", "vitest", "list", "--filesOnly"], { encoding: "utf8" });
  process.stdout.write(files);
  assert.match(files, /artifacts-reader-init\.spec\.ts/, "ordinary reader integration must be collected");
  assert.doesNotMatch(files, /tests\/e2e\/artifacts-reader.*\.spec\.ts/, "Vitest must collect zero H5 browser files");
} catch (error) {
  failure = error;
  process.stderr.write(`Vitest collection failed: ${error.message}\n`);
}

const listing = execFileSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--list",
  "--config=tools/h5-artifacts.playwright.config.ts", "--reporter=json"], { encoding: "utf8" });
const report = JSON.parse(listing);
assert.equal(report.errors?.length ?? 0, 0, "Playwright collection must have no errors");
const cases = [];
function visit(suites) {
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) cases.push({ file: spec.file, title: spec.title });
    visit(suite.suites ?? []);
  }
}
visit(report.suites ?? []);
for (const file of expected) assert(cases.some(test => test.file.endsWith(file)), `no Playwright cases in ${file}`);
console.log(JSON.stringify({ playwrightCases: cases, count: cases.length }));
if (failure) throw failure;
console.log("H5 collection PASS: zero browser files in Vitest, all required files in Playwright");
