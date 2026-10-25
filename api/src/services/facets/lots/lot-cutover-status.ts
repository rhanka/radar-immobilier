/**
 * 6K cutover status: current state plus an operator view over the stored
 * import evidence. Conflicted targets without an activating disposition
 * stay `unavailable`; `keep-pending` and unqualified rows stay `pending`.
 * This is a status view, not the activation gate: the gate re-evaluates
 * a current manifest on demand.
 */
import { and, eq } from "drizzle-orm";
import type { Database } from "../../../db/client.js";
import {
  lotCutoverState,
  lotD5Dispositions,
  lotSourceRows,
} from "../../../db/schema.js";
import type { ManifestRow } from "../lot-migration-report/manifest.js";
import { cutoverTargetKey } from "./lot-project.js";
import { classifyTarget } from "./lot-cutover-classify.js";
import type {
  ActivationGate,
  LotCutoverStatus,
  StoredCutoverTargets,
} from "./lot-cutover-types.js";

/** Current cutover state; absent rows read as a closed gate. */
export async function readLotCutover(
  db: Pick<Database, "select">, workspaceId: string,
): Promise<LotCutoverStatus> {
  const [row] = await db.select().from(lotCutoverState)
    .where(eq(lotCutoverState.workspaceId, workspaceId));
  return {
    workspaceId,
    maintenanceBarrier: row?.maintenanceBarrier ?? false,
    destinationOpen: row?.destinationOpen ?? false,
    manifestSha: row?.manifestSha ?? null,
    activatedAt: row?.activatedAt instanceof Date ? row.activatedAt.toISOString() : null,
  };
}

export async function readCutoverTargets(
  db: Database, workspaceId: string,
): Promise<StoredCutoverTargets> {
  const empty: StoredCutoverTargets = { unavailable: [], pending: [] };
  return db.transaction(async (tx) => {
    const [state] = await tx.select({ manifestSha: lotCutoverState.manifestSha })
      .from(lotCutoverState).where(eq(lotCutoverState.workspaceId, workspaceId));
    const [evidence] = await tx.select({ manifestSha: lotSourceRows.manifestSha })
      .from(lotSourceRows).where(eq(lotSourceRows.workspaceId, workspaceId)).limit(1);
    const manifestSha = state?.manifestSha ?? evidence?.manifestSha ?? null;
    if (!manifestSha) return empty;
    const stored = await tx.select().from(lotSourceRows).where(and(
      eq(lotSourceRows.workspaceId, workspaceId), eq(lotSourceRows.manifestSha, manifestSha)));
    if (stored.length === 0) return empty;
    const recorded = await tx.select({
      targetKey: lotD5Dispositions.targetKey, decision: lotD5Dispositions.decision,
      sourceId: lotD5Dispositions.sourceId,
    }).from(lotD5Dispositions).where(and(
      eq(lotD5Dispositions.workspaceId, workspaceId),
      eq(lotD5Dispositions.manifestSha, manifestSha)));
    const dispositions = new Map(recorded.map((row) =>
      [row.targetKey, { decision: row.decision, sourceId: row.sourceId } as {
        decision: string; sourceId: string | null }]));
    const byTarget = new Map<string, ManifestRow[]>();
    for (const row of stored) {
      const disposition: ManifestRow["disposition"] =
        row.disposition === "mapped" || row.disposition === "conflict"
        || row.disposition === "unresolved" ? row.disposition : "unresolved";
      const manifest: ManifestRow = {
        sourceId: row.sourceId,
        chainId: row.chainId,
        nativeTarget: row.nativeTarget,
        targetQualified: row.destination !== null,
        disposition,
        diagnostics: [...row.diagnostics] as ManifestRow["diagnostics"],
        destination: (row.destination ?? null) as ManifestRow["destination"],
        observed: row.observed as ManifestRow["observed"],
      };
      const key = cutoverTargetKey(manifest);
      byTarget.set(key, [...(byTarget.get(key) ?? []), manifest]);
    }
    const probe: ActivationGate = {
      workspaceId, manifestSha, requiresD5: false, activatable: false,
      reasons: [], ready: [], unavailable: [], pending: [], activatedSourceIds: [],
    };
    for (const [key, rows] of byTarget) {
      classifyTarget(probe, rows, key, dispositions.get(key) ?? null, true);
    }
    probe.unavailable.sort();
    probe.pending.sort((left, right) => left.targetKey < right.targetKey ? -1 : 1);
    return { unavailable: probe.unavailable, pending: probe.pending };
  });
}
