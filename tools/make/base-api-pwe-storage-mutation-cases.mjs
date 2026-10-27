const durable = "services/facets/pw-write-admission-durable.ts";
const consumed = 'if (row.challengeState === "consumed") throw new FacetError(409, "challenge_consumed");';
const update = 'const updated = await tx.update(pwWriteIntents)\n        .set({ challengeState: "consumed", consumedAt: new Date(now) })\n        .where(and(eq(pwWriteIntents.intentId, normalized),\n          eq(pwWriteIntents.challengeState, "pending"))).returning();\n      if (updated.length === 0) throw new FacetError(409, "challenge_consumed");';
const localAnchor = new RegExp(["export function createDurableWriteAdmission", consumed, update]
  .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
const quotaAnchor = 'await reservePwAdmission(tx, `admission:reader:${row.actorId}:${row.workspaceId}`,\n        `admission:workspace:${row.workspaceId}`, normalized);';
const independentQuota = `const { default: pg } = await import("pg");
      const { drizzle } = await import("drizzle-orm/node-postgres");
      const parameters = (tx as unknown as { session: { client: {
        connectionParameters: import("pg").ClientConfig } } }).session.client.connectionParameters;
      const peerPool = new pg.Pool({ ...parameters, password: parameters.password });
      try {
        await drizzle(peerPool).transaction(async (peer) => {
          const { reservePwQuota, PW_QUOTA_LIMITS } = await import("./pw-write-quotas.js");
          // An autonomous bucket counter has no I FK: the parent holds its lock.
          for (const [bucket, limits] of [
            [\x60admission:reader:\x24{row.actorId}:\x24{row.workspaceId}\x60, PW_QUOTA_LIMITS.admissionPerReaderMinute],
            [\x60admission:workspace:\x24{row.workspaceId}\x60, PW_QUOTA_LIMITS.admissionPerWorkspaceMinute],
          ] as const) await reservePwQuota(peer as unknown as WriteTx, "admission", bucket,
            limits.limit, limits.windowSecs);
        });
      } finally { await peerPool.end(); }`;
export const storageCases = [
  ["M06-process-local-consumption", durable, localAnchor, (match) => {
    if (match === "export function createDurableWriteAdmission") {
      return "const pweLocalUsed = new Set<string>();\nexport function createDurableWriteAdmission";
    }
    return match === consumed
      ? 'if (pweLocalUsed.has(normalized)) throw new FacetError(409, "challenge_consumed");'
      : "pweLocalUsed.add(normalized);";
  }, "tests/integration/pwe-replicas.spec.ts", "serialize separate processes", 4],
  ["M13-autonomous-quota", durable, quotaAnchor, independentQuota,
    "tests/integration/pwe-rollback-stages.spec.ts", "roll back after audit"],
];
