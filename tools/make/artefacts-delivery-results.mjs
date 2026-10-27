import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";

assert.equal(process.env.LOT_MIGRATION_DB_TEST, "1");
const summary = {};
for (const [name, minimum, pending] of [["api-ci", 4159, 76], ["provider", 69, 0], ["mcp", 406, 0]]) {
  const report = JSON.parse(readFileSync(`/evidence/${name}.json`, "utf8"));
  assert.equal(report.success, true, `${name}: unsuccessful suite`);
  assert.equal(report.numFailedTests, 0, `${name}: failed tests`);
  assert.equal(report.numFailedTestSuites, 0, `${name}: failed suites`);
  assert(report.numPassedTests >= minimum, `${name}: lost executed coverage`);
  assert(report.numPendingTests <= pending, `${name}: unexpected skipped coverage`);
  summary[name] = { passed: report.numPassedTests, pending: report.numPendingTests };
}
writeFileSync("/evidence/qualification.json", JSON.stringify(summary, null, 2) + "\n");
console.log(summary);
