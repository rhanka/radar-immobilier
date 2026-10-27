/** Mutate only the container's source copy, restore exact bytes, rerun controls. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const workspace = "src/services/facets/mcp-signal-workspace.ts";
const search = "src/services/facets/mcp-signal-search.ts";
const authority = "tests/integration/mcp-signal-search-workspace.spec.ts";
const races = "tests/integration/mcp-signal-search-races.spec.ts";
const visibility = "tests/integration/mcp-signal-search-visibility.spec.ts";
const budget = "tests/integration/mcp-signal-search-document-budget.spec.ts";
const cases = [
  ["selector-substitution", workspace,
    'if (!ids.includes(parsed.data)) throw new ScopeError(403, "workspace_not_authorized");',
    'if (!ids.includes(parsed.data)) return ids[0];', authority,
    "resolves only 0/1/N current memberships without substituting a selector"],
  ["membership-set", workspace,
    "const current = await resolveMcpSignalWorkspace(db, sub, selector);", "const current = workspaceId;", races,
    "rejects added authority after documentary enrichment starts"],
  ["revoked-memberships", "src/services/workspaces/store.ts",
    'eq(workspaceMemberships.status, "active")',
    'eq(workspaceMemberships.status, workspaceMemberships.status)', authority,
    "resolves only 0/1/N current memberships without substituting a selector"],
  ["approval", "src/services/workspaces/store.ts",
    'eq(accountUsers.status, "approved")', 'eq(accountUsers.status, accountUsers.status)', races,
    "rejects unapproved authority after documentary enrichment starts"],
  ["personal-mask", search,
    "archive.filter((row) => row.effectiveDiscarded)", 'archive.filter((row) => row.workspace?.state === "active")', visibility,
    "masks personal OR common archives while leaving another member's personal state private"],
  ["common-mask", search,
    "archive.filter((row) => row.effectiveDiscarded)", 'archive.filter((row) => row.personal?.state === "active")', visibility,
    "masks personal OR common archives while leaving another member's personal state private"],
  ["post-enrichment-revisions", "src/services/facets/projection-revisions.ts",
    "if (before.token === after.token) return { scope: after, payload };",
    "if (true) return { scope: after, payload };", races,
    "discards stale source cards and reuses the documentary cache on retry"],
  ["request-document-context", search,
    "enrichment ??= createDocEnrichmentContext(deps.docEnrichmentBudgetMs);",
    "enrichment = createDocEnrichmentContext(deps.docEnrichmentBudgetMs);", budget,
    "shares one deadline and cache across retries without resolving new refs after expiry"],
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function run(suite, label) {
  const reportPath = `/evidence/${label}.json`;
  const run = spawnSync("../node_modules/.bin/vitest", ["run", "--config", "vitest.isolated.config.ts",
    "--reporter=json", `--outputFile=${reportPath}`, suite],
  { encoding: "utf8", timeout: 120_000, maxBuffer: 20 * 1024 * 1024 });
  writeFileSync(`/evidence/${label}.log`, `${run.stdout ?? ""}\n${run.stderr ?? ""}`);
  if (run.error || run.signal) throw new Error(`Runner failure for ${label}: ${run.error ?? run.signal}`);
  return { status: run.status, report: JSON.parse(readFileSync(reportPath, "utf8")) };
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
  control(run(suite, `${id}-before`), id);
  let mutant;
  try {
    writeFileSync(file, source.replace(before, after));
    mutant = run(suite, `${id}-mutant`);
  } finally { writeFileSync(file, bytes); }
  if (digest(readFileSync(file)) !== digest(bytes)) throw new Error(`Restoration failed: ${id}`);
  control(run(suite, `${id}-restored`), id);
  const failed = mutant.report.testResults.flatMap((s) => s.assertionResults ?? [])
    .filter((a) => a.status === "failed");
  const named = failed.find((a) => a.fullName.includes(assertion)
    && a.failureMessages.some((m) => m.includes("AssertionError")));
  if (mutant.status === 0 || !named) throw new Error(`No named business assertion killed ${id}`);
  results.push({ id, suite, assertion: named.fullName, verdict: "killed", restoredSha256: digest(bytes),
    failedAssertions: failed.map((a) => a.fullName) });
  writeFileSync("/evidence/mutations.json", JSON.stringify(results, null, 2) + "\n");
  console.log(`KILLED ${id}; exact-byte restoration and controls PASS`);
}
console.log(`PASS ${results.length} named behavioral mutants`);
