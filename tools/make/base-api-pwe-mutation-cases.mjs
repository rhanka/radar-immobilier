const identity = "tests/integration/pwe-identity-domains.spec.ts";
const normal = "tests/integration/pwe-normal-guards.spec.ts";
const principal = "artifacts/write-intent-principal.ts";
const confirmation = "services/facets/pw-write-confirmation.ts";
const durable = "services/facets/pw-write-admission-durable.ts";
export const cases = [
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
