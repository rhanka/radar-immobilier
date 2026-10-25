import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// This script runs only inside the disposable quality container's /workspace copy.
assert.equal(process.cwd(), "/workspace");
const file = "api/src/scripts/base-preprod-job.ts";
const original = readFileSync(file, "utf8");
const mutants = [
  ["init-uuid", "invocation.binding.workspaceId !== null ||", "false ||"],
  ["init-result", 'if (!row || row.slug !== invocation.binding.workspaceSlug) throw new Error("workspace_destination_mismatch");', ""],
  ["image-release", "invocation.binding.releaseId.split(/[:/]/)[0] !== releaseSha", "false"],
  ["sql-preflight", 'if (invocation.action !== "inspect") await assertPrivileges(handle.db, invocation.action);', ""],
];
function run(label) {
  const output = `/evidence/mutation-${label}.json`;
  const child = spawnSync("../node_modules/.bin/vitest", ["run", "tests/integration/base-preprod-job.spec.ts",
    "--config", "vitest.isolated.config.ts", "--reporter=json", `--outputFile=${output}`],
  { cwd: "/workspace/api", encoding: "utf8", timeout: 120_000 });
  assert.ifError(child.error);
  const results = JSON.parse(readFileSync(output, "utf8"));
  assert(results.numTotalTests > 0 && results.numPendingTests === 0);
  return { code: child.status, failed: results.numFailedTests, passed: results.numPassedTests };
}
assert.equal(run("baseline").code, 0);
for (const [name, from, to] of mutants) {
  assert(original.includes(from), `missing mutation anchor: ${name}`);
  try {
    writeFileSync(file, original.replace(from, to));
    const result = run(name);
    assert.equal(result.code, 1, `${name} survived`);
    assert(result.failed > 0, `${name} failed without an assertion`);
    console.log(JSON.stringify({ mutation: name, ...result }));
  } finally { writeFileSync(file, original); }
}
assert.equal(run("restored").code, 0);
console.log("PASS four runtime mutations, baseline/restored exit 0");
