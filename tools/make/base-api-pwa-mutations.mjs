import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const guards = "tests/integration/pw-write-authority-guards.spec.ts";
const replay = "tests/integration/pw-write-authority.spec.ts";
const grant = "src/artifacts/write-grant.test.ts";
const review = "src/artifacts/write-intent-app-review.test.ts";
const races = "tests/integration/pw-write-authority-status.spec.ts";
const timeouts = "tests/integration/pw-write-authority-timeouts.spec.ts";
const mutations = [
  ["csrf-origin", "write-intent-app-guard.ts", 'if (c.req.header("origin") !== appOrigin)', 'if (false)', guards, "isolated CSRF failures"],
  ["csrf-token", "write-intent-app-authority.ts", "if (!verifyWriteIntentCsrf({", "if (false && !verifyWriteIntentCsrf({", guards, "isolated CSRF failures"],
  ["cookie-only", "write-intent-app-guard.ts", 'if (c.req.header("authorization") !== undefined)', "if (false)", guards, "Authorization on every app route"],
  ["grant-class", "write-grant.ts", 'claims.grantKind !== "write" || ', "", grant, "independent class, P and identity bindings"],
  ["grant-page", "write-grant.ts", 'const want = expected[field];', 'const want = field === "sessionId" ? undefined : expected[field];', grant, "independent class, P and identity bindings"],
  ["grant-identity", "write-grant.ts", 'const want = expected[field];', 'const want = field === "identityIssuer" ? undefined : expected[field];', grant, "independent class, P and identity bindings"],
  ["replay-refusal", "write-intent-errors.ts", 'export function writeIntentError(c: Context, error: unknown): Response {', 'export function writeIntentError(c: Context, error: unknown): Response {\n  if (error instanceof Error && error.message === "challenge_consumed") return c.json({ success: true }, 200);', replay, "refuse replay exactly"],
  ["summary-membership", "write-intent-app-route.ts", " || !await canReadWriteIntentSummary(deps, row, pass)", "", review, "membership loss with approval intact"],
  ["summary-moderation", "write-intent-app-authority.ts", "|| access.moderateArchive", "|| true", review, "common archive capability loss"],
  ["management-404", "write-intent-app-authority.ts", "management && error instanceof PwWriteError", "false && error instanceof PwWriteError", review, "normalize foreign management references"],
  ["revoke-404", "write-intent-app-route.ts", 'pass, action === "revoke"', "pass, false", "tests/integration/pw-write-authority-rights.spec.ts", "hide foreign and absent management references"],
  ["prepare-path", "write-intent-h5-route.ts", 'app.post("/write-intents",', 'app.post("/write-intents/prepare",', replay, "prepare idempotently"],
  ["grant-expiry", "write-grant.ts", 'if (payload.exp * 1000 <= nowMs) throw new FacetError(401, "write_grant_expired");', "", grant, "only authenticated and correctly bound grant expiration"],
  ["page-expiry", "write-intent-page-authority.ts", 'throw new FacetError(401, "page_session_expired")', 'throw new FacetError(403, "write_grant_required")', "src/artifacts/write-intent-page-authority.test.ts", "authenticated P expiry"],
  ["receipt-intent-revoke", "write-intent-h5-route.ts", 'if (fresh.row.revokedAt !== null)', "if (false)", races, "intent withdrawal completes"],
  ...["grant", "page_session", "expiry"].map(kind => [`receipt-final-${kind}`, "write-intent-h5-route.ts",
    "const fresh = await readPageBoundWriteIntent(c, deps, id);", "const fresh = { row };", races, `${kind} withdrawal completes`]),
  ["lock-timeout", "write-intent-transaction.ts", "await tx.execute(sql`SET LOCAL lock_timeout = '1s'`);", "", timeouts, "summary contention exactly"],
  ["statement-timeout", "write-intent-transaction.ts", "await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);", "", timeouts, "slow SQL statement"],
];

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const receipts = [];
function run(name, scope, title) {
  const output = `/evidence/mutation-${name}.json`;
  const result = spawnSync("../node_modules/.bin/vitest", ["run", "--config", "vitest.isolated.config.ts",
    "--reporter=default", "--reporter=json", `--outputFile.json=${output}`, scope, "-t", title],
  { cwd: "/workspace/api", encoding: "utf8", timeout: 180_000 });
  writeFileSync(`/evidence/mutation-${name}.log`, (result.stdout ?? "") + (result.stderr ?? ""));
  if (result.error || result.signal) throw result.error ?? new Error(`Mutation process signal: ${result.signal}`);
  const report = JSON.parse(readFileSync(output, "utf8"));
  const assertions = report.testResults.flatMap(suite => suite.assertionResults ?? []);
  const selected = assertions.filter(test => test.fullName.includes(title));
  if (!selected.length) throw new Error(`Missing functional case: ${name}`);
  return { result, selected, report };
}
for (const [name, file, before, after, scope, title] of mutations) {
  const path = `/workspace/api/src/artifacts/${file}`;
  const original = readFileSync(path, "utf8");
  if (original.split(before).length !== 2) throw new Error(`Mutation anchor is not unique: ${name}`);
  try {
    writeFileSync(path, original.replace(before, after));
    const { result, selected } = run(name, scope, title);
    if (result.status === 0 || !selected.some(test => test.status === "failed"
      && test.failureMessages.some(message => /AssertionError|expected/i.test(message)))) {
      throw new Error(`Mutant survived or failed without its functional assertion: ${name}`);
    }
  } finally {
    writeFileSync(path, original);
  }
  const restored = run(`${name}-restored`, scope, title);
  if (restored.result.status !== 0 || restored.selected.some(test => test.status !== "passed")) {
    throw new Error(`Restoration failed: ${name}`);
  }
  if (sha(readFileSync(path)) !== sha(original)) throw new Error(`Restoration bytes differ: ${name}`);
  receipts.push({ name, scope, title, killed: true, restored: true, sha256: sha(original) });
  writeFileSync("/evidence/mutations.json", JSON.stringify(receipts, null, 2));
  console.log(`KILLED and RESTORED ${name}`);
}
