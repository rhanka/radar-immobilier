import { extraCases } from "./base-api-pwe-extra-mutation-cases.mjs";
import { transactionCases } from "./base-api-pwe-transaction-mutation-cases.mjs";
const identity = "tests/integration/pwe-identity-domains.spec.ts";
const normal = "tests/integration/pwe-normal-guards.spec.ts";
const principal = "artifacts/write-intent-principal.ts";
const confirmation = "services/facets/pw-write-confirmation.ts";
const durable = "services/facets/pw-write-admission-durable.ts";
export const cases = [
  ...transactionCases,
  ...extraCases,
  ...["commandKey", "pageInstanceId", "expectedProjectionToken"].map((field) => [
    `M04-binding-${field}`, "services/facets/pw-write-digests.ts",
    field === "commandKey" ? "commandKey: (binding.commandKey as string).toLowerCase(),"
      : `${field}: binding.${field},`, "", "tests/integration/pwe-bindings.spec.ts", `bind ${field} independently`]),
  ["M04-deselection-binding", "services/facets/signal-write-operations.ts",
    'for (const key of ["basket", "reasonCode", "deselect", "expectedSelectionHeads"] as const) {\n    if (input[key] !== undefined) body[key] = input[key];\n  }\n  if (input.deselect !== undefined) body.deselect = [...input.deselect].sort();',
    'for (const key of ["basket", "reasonCode"] as const) {\n    if (input[key] !== undefined) body[key] = input[key];\n  }',
    "tests/integration/pwe-bindings.spec.ts", "different deselection masks"],
  ...[["personal", "personalRevision: scope.personalRevision,"], ["common", "workspaceRevision: scope.workspaceRevision,"],
    ["source", "sourceRevision: scope.sourceRevision,\n    sourceDigest: scope.sourceDigest,"]].map(([kind, anchor]) => [
    `M07-${kind}-scope`, "services/facets/projection-scope.ts", anchor, "",
    "tests/integration/pwe-revisions.spec.ts", `stale intent after the real ${kind} writer commits first`]),
  ["M08-current-head", "services/facets/scoped-writer.ts", "if (conflicted)", "if (false)",
    "tests/integration/pwe-business-guards.spec.ts", "typed head guard"],
  ["M08-current-version", "services/facets/scoped-writer.ts", "if (fingerprint !== command.displayedFingerprint)", "if (false)",
    "tests/integration/pwe-business-guards.spec.ts", "typed version guard"],
  ["M10-final-cookie-clock", "services/facets/pw-write-confirm.ts", "const now = clockMs();", "const now = row.createdAt.getTime();",
    "tests/integration/pwe-expiry-waits.spec.ts", "cookie expiry at the outbox wait"],
  ["M10-final-challenge-clock", "services/facets/signal-write-admission.ts", "const now = clock();", "const now = started;",
    "tests/integration/pwe-expiry-waits.spec.ts", "challenge expiry at the outbox wait"],
  ...[["reader", "`admission:reader:${row.actorId}:${row.workspaceId}`", "six P grants"],
    ["workspace", "`admission:workspace:${row.workspaceId}`", "workspace burst across readers"]].map(([kind, anchor, title]) => [
    `M13-per-intent-${kind}`, durable, anchor, anchor.slice(0, -1) + ":${normalized}`",
    "tests/integration/pwe-shared-quota.spec.ts", title]),
  ["M02-comparator-issuer", principal, "left.issuer === right.issuer && ", "", identity, "different issuer domain"],
  ["M02-comparator-tier", principal, " && left.tier === right.tier", "", identity, "different tier domain"],
  ["M02-owner-issuer", confirmation, "owner.issuer !== principal.issuer || ", "", identity, "different issuer domain"],
  ["M02-owner-tier", confirmation, "\n    || owner.tier !== principal.tier", "", identity, "different tier domain"],
  ["M02-H5-issuer-confusion", principal, "issuer: grant.identityIssuer, sub: grant.readerSub",
    'issuer: "issuer" in grant ? String(grant.issuer) : grant.identityIssuer, sub: grant.readerSub', identity,
    "equal app/write principals despite a distinct H5 issuer"],
  ["M03-normal-origin", "artifacts/write-intent-app-guard.ts", 'if (c.req.header("origin") !== appOrigin)',
    "if (false)", normal, "discriminate Origin and CSRF independently"],
  ["M03-normal-csrf", "artifacts/write-intent-app-authority.ts", "if (!verifyWriteIntentCsrf({",
    "if (false && !verifyWriteIntentCsrf({", normal, "discriminate Origin and CSRF independently"],
  ["M03-normal-cookie-remint", "artifacts/write-intent-csrf.ts", "[principal.issuer, principal.sub, principal.tier], cookieHash,",
    '[principal.issuer, principal.sub, principal.tier], "unbound",', "tests/integration/pwe-normal-remint.spec.ts",
    "invalidate old CSRF after real me remint"],
  ...["tier", "policy", "release", "delegation", "reader", "grant", "page_session"].map((kind) => [
    `M09-fence-${kind}`, "services/facets/pw-write-fences.ts", "if (await fenced(tx, kind, reference))",
    `if (kind !== "${kind}" && await fenced(tx, kind, reference))`,
    "tests/integration/pwe-authority-before.spec.ts", `when ${kind} withdrawal commits before`]),
  ["M06-durable-consumption", durable, 'challengeState: "consumed", consumedAt:', 'challengeState: "pending", consumedAt:',
    "tests/integration/pwe-replicas.spec.ts", "serialize separate processes"],
  ["M13-admission-debits", durable,
    "await reservePwAdmission(tx, `admission:reader:${row.actorId}:${row.workspaceId}`,\n        `admission:workspace:${row.workspaceId}`, normalized);",
    "", "tests/integration/pwe-rollback-stages.spec.ts", "roll back after admission quota"],
  ["M16-committed-expiry", "services/facets/pw-write-fences.ts",
    'if (row.executionState === "committed" || row.executionState === "rejected") {',
    'if (nowMs >= row.expiresAt.getTime()) return "expired";\n  if (row.executionState === "committed" || row.executionState === "rejected") {',
    "tests/integration/pwe-status-contention.spec.ts", "premature expired decision with confirm rollback=false"],
];
