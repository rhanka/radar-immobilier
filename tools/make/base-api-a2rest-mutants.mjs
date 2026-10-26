/** Mutate the container copy only, with named assertion failures and byte restoration. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cases } from "./base-api-a2rest-mutation-cases.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function run(suite, label) {
  const reportPath = `/evidence/${label}.json`;
  const result = spawnSync("../node_modules/.bin/vitest", ["run", "--config", "vitest.isolated.config.ts",
    "--reporter=json", `--outputFile=${reportPath}`, suite],
  { cwd: "/workspace/api", encoding: "utf8", timeout: 120_000, maxBuffer: 20 * 1024 * 1024 });
  writeFileSync(`/evidence/${label}.log`, `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  if (result.error || result.signal) throw new Error(`Runner failure for ${label}: ${result.error ?? result.signal}`);
  return { status: result.status, report: JSON.parse(readFileSync(reportPath, "utf8")) };
}
function control(result, id) {
  const r = result.report;
  if (result.status !== 0 || !r.success || r.numTotalTests < 1 || r.numFailedTests !== 0
    || r.numPendingTests !== 0 || (r.numTodoTests ?? 0) !== 0) throw new Error(`Control failed: ${id}`);
}
const results = [];
for (const [id, file, before, after, suite, assertion] of cases) {
  const bytes = readFileSync(file);
  const source = bytes.toString("utf8");
  if (source.split(before).length !== 2) throw new Error(`Nonunique mutation anchor: ${id}`);
  const initial = run(suite, `${id}-before`);
  control(initial, id);
  let mutant;
  try {
    writeFileSync(file, source.replace(before, after));
    mutant = run(suite, `${id}-mutant`);
  } finally { writeFileSync(file, bytes); }
  if (digest(readFileSync(file)) !== digest(bytes)) throw new Error(`Restoration failed: ${id}`);
  const restored = run(suite, `${id}-restored`);
  control(restored, id);
  const failed = mutant.report.testResults.flatMap((s) => s.assertionResults ?? [])
    .filter((a) => a.status === "failed");
  const named = failed.find((a) => a.fullName.includes(assertion)
    && a.failureMessages.some((m) => m.includes("AssertionError")));
  if (mutant.status === 0 || !named) throw new Error(`No named business assertion killed ${id}`);
  results.push({ id, file, suite, assertion: named.fullName, verdict: "killed", restoredSha256: digest(bytes),
    controls: { before: initial.report.numTotalTests, restored: restored.report.numTotalTests,
      failed: 0, skipped: 0 }, mutantFailedTests: mutant.report.numFailedTests,
    failedAssertions: failed.map((a) => a.fullName) });
  writeFileSync("/evidence/mutations.json", JSON.stringify(results, null, 2) + "\n");
  console.log(`KILLED ${id}; exact-byte restoration and controls PASS`);
}
console.log(`PASS ${results.length} named behavioral mutants`);
