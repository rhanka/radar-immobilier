/**
 * 6K activation gate.
 *
 * The gate reads destination, epoch, writer coverage, and recorded D5
 * dispositions; it never writes. Without conflicts there is no approval
 * step; with conflicts every affected target needs a recorded disposition
 * before activation (see `lot-cutover-dispositions`).
 */
import { and, eq } from "drizzle-orm";
import type { Database } from "../../../db/client.js";
import {
  lotD5Dispositions,
  lotDestinationState,
} from "../../../db/schema.js";
import { lockWorkspace } from "../../workspaces/mutations.js";
import { scopedEpochFor } from "../activation.js";
import { SCOPED_EPOCH } from "../scope.js";
import type {
  LotMigrationReport,
  ManifestRow,
} from "../lot-migration-report/manifest.js";
import { uncoveredLotSourceWriters } from "./lot-source-coverage.js";
import { cutoverTargetKey } from "./lot-project.js";
import { classifyTarget } from "./lot-cutover-classify.js";
import { cutoverRosterGaps } from "./lot-cutover-roster.js";
import type { ActivationGate } from "./lot-cutover-types.js";

/** Evaluate the activation gate for one manifest. */
export async function evaluateActivationGate(
  db: Database, workspaceId: string, report: LotMigrationReport,
): Promise<ActivationGate> {
  const gate: ActivationGate = {
    workspaceId,
    manifestSha: report.manifestSha256,
    requiresD5: false,
    activatable: false,
    reasons: [],
    ready: [],
    unavailable: [],
    pending: [],
    activatedSourceIds: [],
  };
  await db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    gate.reasons.push(...await cutoverRosterGaps(tx, workspaceId));
    const [destination] = await tx.select().from(lotDestinationState)
      .where(eq(lotDestinationState.workspaceId, workspaceId));
    if (!destination || destination.enabled !== true
      || typeof destination.selectionBasket !== "string" || destination.selectionBasket === "") {
      gate.reasons.push("lot_destination_disabled");
    }
    if (await scopedEpochFor(tx, workspaceId) !== SCOPED_EPOCH) {
      gate.reasons.push("scoped_epoch_unavailable");
    }
    const uncovered = await uncoveredLotSourceWriters(tx);
    if (uncovered.length > 0) {
      gate.reasons.push(`source_writers_uncovered:${uncovered.join(",")}`);
    }
    if (report.destinationsQualified !== true) {
      gate.reasons.push("destination_scope_unqualified");
    }
    const recorded = await tx.select({
      targetKey: lotD5Dispositions.targetKey, decision: lotD5Dispositions.decision,
      sourceId: lotD5Dispositions.sourceId,
    }).from(lotD5Dispositions).where(and(
      eq(lotD5Dispositions.workspaceId, workspaceId),
      eq(lotD5Dispositions.manifestSha, report.manifestSha256)));
    const dispositions = new Map(recorded.map((row) =>
      [row.targetKey, { decision: row.decision, sourceId: row.sourceId } as {
        decision: string; sourceId: string | null }]));
    const grouped = new Map<string, ManifestRow[]>();
    for (const row of report.rows) {
      const key = cutoverTargetKey(row);
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }
    for (const [key, rows] of grouped) {
      classifyTarget(gate, rows, key, dispositions.get(key) ?? null,
        report.destinationsQualified === true);
    }
  });
  gate.requiresD5 = report.rows.some((row) => row.disposition === "conflict");
  if (gate.unavailable.length > 0) {
    gate.reasons.push(`d5_dispositions_missing:${gate.unavailable.length}`);
  }
  if (gate.ready.length === 0) {
    gate.reasons.push("no_activatable_targets");
  }
  gate.ready.sort();
  gate.unavailable.sort();
  gate.pending.sort((left, right) => left.targetKey < right.targetKey ? -1 : 1);
  gate.activatable = gate.reasons.length === 0;
  return gate;
}
