import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

for (const label of ["unit", "postgres", "full"]) {
  const file = `/evidence/${label}.json`;
  if (!existsSync(file)) {
    assert.equal(label, "full", `Missing required report: ${label}`);
    continue;
  }
  const report = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(report.success, true, `Failed campaign: ${label}`);
  assert.ok(report.numPassedTests > 0, `No executed tests: ${label}`);
  assert.equal(report.numFailedTests, 0, `Failed tests: ${label}`);
  if (label !== "full") assert.equal(report.numPendingTests, 0, `Required skips: ${label}`);
  console.log(`${label}: ${report.numPassedTests} passed, ${report.numFailedTests} failed, ${report.numPendingTests} skipped`);
}
