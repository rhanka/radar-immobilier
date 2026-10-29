const coordinator = "services/facets/signal-write-admission.ts";
const wrapper = 'return db.transaction((tx) => executeSignalWriteInTx(tx, sub, prepared, admission, clock),\n    { isolationLevel: "read committed" });';
const rollback = "tests/integration/pwe-rollback-stages.spec.ts";
export const transactionCases = [
  ["M04-dispatch-payload-substitution", coordinator, "basket: input.basket,", 'basket: "a_surveiller" as const,',
    "tests/integration/pwe-confirm-payload.spec.ts", "execute only the server summary"],
  ["M04-accept-confirm-fields", "artifacts/write-intent-app-route.ts",
    'Object.keys(body).sort().join(",") !== (action === "confirm" ? "challengeToken" : "")', "false",
    "tests/integration/pwe-confirm-payload.spec.ts", "execute only the server summary"],
  ["M08-current-reason", "services/facets/scoped-transition.ts",
    'if (!reason) throw new FacetError(422, "invalid_reason_code");', "void reason;",
    "tests/integration/pwe-business-guards.spec.ts", "typed reason guard"],
  ["M06-consumption-after-separate-commit", coordinator, wrapper,
    'const result = await db.transaction((tx) => executeSignalWriteInTx(tx, sub, prepared,\n      { ...admission, consume: async () => {} }, clock), { isolationLevel: "read committed" });\n    await db.transaction((tx) => admission.consume(tx));\n    return result;',
    rollback, "roll back after consumption"],
  ["M13-audit-after-separate-commit", coordinator, wrapper,
    'const result = await db.transaction((tx) => executeSignalWriteInTx(tx, sub, prepared,\n      { ...admission, recordCommit: async () => {} }, clock), { isolationLevel: "read committed" });\n    await db.transaction((tx) => admission.recordCommit(tx, result));\n    return result;',
    rollback, "roll back after audit"],
];
