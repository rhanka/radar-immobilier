import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const mutations = [
  ["html-inline-extraction", "api/src/artifacts/release-files.ts",
    'visit(parse(normalizeReleaseHtml(html)));',
    'for (const tag of ["script", "style"]) for (const match of normalizeReleaseHtml(html).matchAll(new RegExp("<" + tag + "\\\\b[^>]*>([\\\\s\\\\S]*?)<\\\\/" + tag + "\\\\s*>", "gi"))) hashes[tag].push("\\x27sha256-" + createHash("sha256").update(match[1]).digest("base64") + "\\x27");',
    "src/artifacts/release-isolation.test.ts"],
  ["navigation-query", "api/src/artifacts/content-serve.ts",
    'return c.redirect(`${target.pathname}${target.search}`, 303);',
    'return c.redirect(`${c.req.path}?grant=${encodeURIComponent(grant)}`, 303);',
    "src/artifacts/reader-native-files.test.ts"],
  ["reader-substitution", "api/src/artifacts/reader-baskets.ts", /context.readerSub/g, '"author-alice"',
    "tests/integration/artifacts-baskets.spec.ts"],
  ["cookie-grant-binding", "api/src/artifacts/content-serve.ts",
    "if (!session || session.sid !== claims.sessionId || session.readerSub !== claims.readerSub || session.artifactId !== claims.artifactId) return null;",
    "if (!session) return null;", "tests/integration/artifacts-baskets.spec.ts"],
  ["artifact-acl", "api/src/artifacts/reader-storage.ts",
    "account.rowCount === 1 && allowed", "account.rowCount === 1",
    "tests/integration/artifacts-baskets.spec.ts"],
  ["blob-integrity", "api/src/artifacts/reader-storage.ts",
    'createHash("sha256").update(body).digest("hex") !== file.digest.slice(7)', "false",
    "tests/integration/artifacts-baskets.spec.ts"],
  ["workspace-membership", "api/src/services/workspaces/store.ts",
    'if (membership?.status !== "active")', "if (false)", "tests/integration/artifacts-baskets.spec.ts"],
  ["release-wait-authorization", "api/src/artifacts/content-serve.ts",
    'if (!stillOpen(auth) || !await authorityCurrent(auth)) return c.json({ error: "unauthenticated" }, 401);',
    "", "src/artifacts/release-isolation.test.ts"],
  ["byte-credential-leak", "api/src/artifacts/content-serve.ts", "if (servedBodyLeaksCredentials(text))", "if (false)",
    "src/artifacts/release-isolation.test.ts"],
  ["single-use-ticket", "api/src/artifacts/reader-tickets.ts",
    "DELETE FROM artifacts.reader_tickets\n        WHERE", "SELECT payload, extract(epoch FROM expires_at)*1000 AS expires FROM artifacts.reader_tickets\n        WHERE",
    "tests/integration/artifacts-reader-opening.spec.ts"],
  ["approval-origin", "api/src/artifacts/reader-opening.ts",
    'c.req.header("origin") !== deps.auth.appBaseUrl', "false", "tests/integration/artifacts-reader-opening.spec.ts"],
  ["script-isolation", "api/src/artifacts/release-files.ts", "worker-src 'none'", "worker-src 'self'",
    "src/artifacts/release-isolation.test.ts"],
];
const evidence = "/evidence";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const receipts = [];
function run(name, phase, scope) {
  const report = `${evidence}/mutation-${name}-${phase}.json`;
  const result = spawnSync(process.execPath, ["/workspace/node_modules/vitest/vitest.mjs", "run", scope,
    "--maxWorkers=1", "--reporter=json", `--outputFile=${report}`], {
    cwd: "/workspace/api", encoding: "utf8", timeout: 120_000,
  });
  assert(!result.error, result.error?.message);
  const data = JSON.parse(readFileSync(report, "utf8"));
  writeFileSync(`${evidence}/mutation-${name}-${phase}.log`, result.stdout + result.stderr);
  return { exit: result.status, passed: data.numPassedTests, failed: data.numFailedTests,
    skipped: data.numPendingTests, failures: data.testResults.flatMap((suite) => suite.assertionResults)
      .filter((test) => test.status === "failed").map((test) => test.fullName) };
}
for (const [name, file, search, replacement, scope] of mutations) {
  const original = readFileSync(file);
  let changed = original.toString().replace(search, replacement);
  if (name === "single-use-ticket") changed = changed.replace(
    "AND expires_at>now()\n        RETURNING payload, extract(epoch FROM expires_at)*1000 AS expires",
    "AND expires_at>now()");
  assert.notEqual(changed, original.toString(), `${name} must apply`);
  const before = run(name, "before", scope);
  assert(before.exit === 0 && before.passed > 0 && before.skipped === 0, `${name} passing control`);
  let mutant;
  try {
    writeFileSync(file, changed);
    mutant = run(name, "mutant", scope);
    assert(mutant.exit !== 0 && mutant.failed > 0, `${name} behavioral kill`);
  } finally {
    writeFileSync(file, original);
    assert.equal(hash(readFileSync(file)), hash(original));
  }
  const after = run(name, "after", scope);
  assert(after.exit === 0 && after.passed > 0 && after.skipped === 0, `${name} restored control`);
  receipts.push({ name, file, before, mutant, after, restoredSha256: hash(original) });
  console.log(JSON.stringify(receipts.at(-1)));
  writeFileSync(`${evidence}/mutations.json`, JSON.stringify(receipts, null, 2));
}
