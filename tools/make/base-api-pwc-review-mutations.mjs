import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cases } from "./base-api-pwc-review-cases.mjs";

const receipts = [];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const root = "/workspace/api/src/";
const protectedFile = `${root}artifacts/write-intent-transaction.ts`;
const protectedHash = hash(readFileSync(protectedFile));
function run(name, scope, title, phase) {
  const prefix = `/evidence/pwcr-mutants/${name}-${phase}`;
  const result = spawnSync("../node_modules/.bin/vitest", ["run", "--config", "vitest.isolated.config.ts",
    scope, "-t", title, "--reporter=json", `--outputFile.json=${prefix}.json`],
  { cwd: "/workspace/api", encoding: "utf8", timeout: 60_000 });
  writeFileSync(`${prefix}.log`, (result.stdout ?? "") + (result.stderr ?? ""));
  if (result.error || result.signal) throw result.error ?? new Error(`Process signal in ${name}/${phase}`);
  const report = JSON.parse(readFileSync(`${prefix}.json`, "utf8"));
  const selected = report.testResults.flatMap((suite) => suite.assertionResults ?? [])
    .filter((test) => test.fullName.includes(title));
  if (!selected.length) throw new Error(`No targeted assertion: ${name}/${phase}`);
  if (phase === "mutated") {
    if (selected.some((test) => !["passed", "failed"].includes(test.status))) {
      throw new Error(`Targeted mutation case was skipped: ${name}`);
    }
    if (result.status !== 1 || !selected.some((test) => test.status === "failed"
      && test.failureMessages.some((message) => /AssertionError|__VITEST_REJECTS__/.test(message)))) {
      throw new Error(`No targeted functional red: ${name}`);
    }
  } else if (result.status !== 0 || selected.some((test) => test.status !== "passed") || !report.success) {
    throw new Error(`Green gate failed: ${name}/${phase}`);
  }
  return selected.map(({ fullName, status, failureMessages }) => ({ fullName, status,
    ...(phase === "mutated" ? { failureMessages } : {}) }));
}
mkdirSync("/evidence/pwcr-mutants", { recursive: true });
const filter = new RegExp(process.env.PWCR_MUTATION_FILTER ?? ".*");
const selectedCases = cases.filter(([name]) => filter.test(name));
if (!selectedCases.length) throw new Error("Mutation filter selected no required variant");
for (const [name, file, before, after, scope, title, expected = 1] of selectedCases) {
  const path = root + file;
  const original = readFileSync(path);
  const receipt = { name, file, scope, title, sha256: hash(original) };
  try {
    if (original.toString().split(before).length !== expected + 1) throw new Error(`Nonunique anchor: ${name}`);
    receipt.baseline = run(name, scope, title, "baseline");
    try {
      writeFileSync(path, original.toString().replace(before, after));
      receipt.mutated = run(name, scope, title, "mutated");
    } finally { writeFileSync(path, original); }
    receipt.restored = run(name, scope, title, "restored");
    if (hash(readFileSync(path)) !== receipt.sha256) throw new Error(`Byte restoration failed: ${name}`);
    receipt.killed = true;
    console.log(`KILLED and RESTORED ${name}`);
  } catch (error) {
    receipt.error = error.message;
    console.error(`MUTATION FAILURE ${name}: ${error.message}`);
  } finally {
    writeFileSync(path, original);
    receipts.push(receipt);
    writeFileSync("/evidence/pwcr-mutants/results.json", JSON.stringify(receipts, null, 2));
  }
}
if (hash(readFileSync(protectedFile)) !== protectedHash) throw new Error("Protected transaction file changed");
if (receipts.some((receipt) => !receipt.killed)) process.exitCode = 1;
