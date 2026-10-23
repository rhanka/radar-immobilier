import assert from "node:assert/strict";
import process from "node:process";
import console from "node:console";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const mutations = [
  ["gcm-tag-truncation", "preview-aead.ts", ", { authTagLength: 16 }", "", "preview-aead.test.ts"],
  ["ticket-single-use", "preview-tickets.ts", "live.delete(ticket);", "void ticket;", "preview-security.test.ts"],
  ["grant-binding", "preview-grant.ts", "const want = expected[field];", "const want = undefined;", "preview-grant.test.ts"],
  ["publisher-substitution", "reader-test-fixture.ts", "reader: context.readerSub", 'reader: "publisher"', "content-serve.test.ts"],
  ["content-url", "reader-operations.ts", /\.strict\(\)/g, ".passthrough()", "reader-security.test.ts"],
  ["renewal-approval", "preview-renewal.ts", "!rights || !rights.approved || rights.readerSub !== verified.readerSub", "!rights", "preview-security.test.ts"],
  ["old-tab-release", "reader-context.ts", "if (!release || release.artifactId !== grant.artifactId || release.releaseId !== grant.releaseId) return null;", "void release;", "reader-context.test.ts"],
  ["service-worker-fallback", "content-serve.ts", 'c.req.header("service-worker") || ', "", "reader-security.test.ts"],
];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const base = mkdtempSync("/h5-mutations-");
const receipts = [];
const sourceHashes = new Map(mutations.map(([, file]) => {
  const source = `api/src/artifacts/${file}`;
  return [source, hash(readFileSync(source))];
}));
try {
  for (const [name, file, search, replacement, spec] of mutations) {
    const root = path.join(base, name);
    mkdirSync(path.join(root, "api/src"), { recursive: true });
    cpSync("api/src/artifacts", path.join(root, "api/src/artifacts"), { recursive: true });
    for (const source of ["package.json", "tsconfig.base.json", "api/package.json", "api/tsconfig.json", "api/vitest.config.ts"]) {
      cpSync(source, path.join(root, source));
    }
    symlinkSync("/workspace/node_modules", path.join(root, "node_modules"));
    const target = path.join(root, "api/src/artifacts", file);
    const bytes = readFileSync(target);
    const original = bytes.toString();
    const changed = original.replace(search, replacement);
    assert.notEqual(changed, original, `mutation ${name} must apply`);
    function run(phase) {
      const report = path.join(root, `${phase}.json`);
      const result = spawnSync(process.execPath, ["/workspace/node_modules/vitest/vitest.mjs", "run",
        `src/artifacts/${spec}`, "--reporter=json", `--outputFile=${report}`],
      { cwd: path.join(root, "api"), encoding: "utf8", timeout: 60_000 });
      assert(!result.error, result.error?.message);
      const data = JSON.parse(readFileSync(report, "utf8"));
      return { exit: result.status, passed: data.numPassedTests, failed: data.numFailedTests,
        pending: data.numPendingTests, cases: data.testResults.flatMap(suite => suite.assertionResults)
          .map(test => ({ name: test.fullName, status: test.status })) };
    }
    const before = run("before");
    assert.equal(before.exit, 0, `${name} passing control`);
    assert(before.passed > 0 && before.pending === 0);
    writeFileSync(target, changed);
    const mutant = run("mutant");
    assert.notEqual(mutant.exit, 0, `${name} must fail`);
    assert(mutant.failed > 0, `${name} must fail a behavioral assertion`);
    writeFileSync(target, bytes);
    assert.equal(hash(readFileSync(target)), hash(bytes), `${name} byte restoration`);
    const after = run("after");
    assert.equal(after.exit, 0, `${name} restored control`);
    assert(after.passed > 0 && after.pending === 0);
    receipts.push({ name, before, mutant, after, restoredSha256: hash(bytes) });
    console.log(JSON.stringify(receipts.at(-1)));
  }
  for (const [source, before] of sourceHashes) assert.equal(hash(readFileSync(source)), before, "source unchanged");
  console.log(JSON.stringify({ scope: "module tests only", killed: receipts.length, requiredStreamMutation: "unverified: no stream implementation" }));
} finally {
  rmSync(base, { recursive: true, force: true });
}
