import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const scope = (process.env.PWE_REQUIRED_SCOPE ?? "").trim().split(/\s+/).filter(Boolean);
assert.ok(scope.length > 0, "Required PW-E scope must be explicit and nonempty");
for (const label of ["required", "full"]) {
  const path = `/evidence/${label}.json`;
  if (!existsSync(path)) {
    assert.equal(label, "full", "Missing required execution report");
    continue;
  }
  const report = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(report.success, true, `Failed campaign: ${label}`);
  assert.equal(report.numFailedTests, 0, `Failed cases: ${label}`);
  assert.equal(report.numFailedTestSuites, 0, `Failed suites: ${label}`);
  assert.ok(report.numPassedTests > 0, `Zero executed assertions: ${label}`);
  if (label === "required") {
    assert.equal(report.numPendingTests, 0, "Required PW-E cases cannot skip");
    for (const file of scope) {
      const suites = report.testResults.filter((suite) => suite.name.endsWith(`/${file}`));
      const cases = suites.flatMap((suite) => suite.assertionResults);
      assert.ok(cases.length > 0, `Required file not executed: ${file}`);
      assert.ok(cases.every((test) => test.status === "passed"), `Nonpassing case: ${file}`);
    }
  }
  console.log(`${label}: ${report.numPassedTests} passed, ${report.numFailedTests} failed, ${report.numPendingTests} skipped`);
}
