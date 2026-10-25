/**
 * Explicit nine-stage cutover. Commit the barrier first, reconcile next,
 * then verify committed reads before opening. Failed runs stay fenced;
 * recovery uses the same import key. An open destination rejects reruns.
 */
import { eq, sql } from "drizzle-orm";
import type { Database } from "../../../db/client.js";
import {
  lotCutoverEvents,
  lotCutoverState,
  lotDestinationState,
} from "../../../db/schema.js";
import { lockWorkspace } from "../../workspaces/mutations.js";
import { approvedAccountId, resolveWorkspaceAccess } from "../../workspaces/store.js";
import { FacetError } from "../target.js";
import { retireLegacyMarkDelivery } from "../../chat/stream-bus.js";
import { runLotImport } from "./lot-importer.js";
import { isProjectableHead } from "./lot-project.js";
import { evaluateActivationGate } from "./lot-cutover-gate.js";
import { openLotDestination } from "./lot-cutover-open.js";
import type {
  CutoverSafety,
  LotCutoverReceipt,
  LotCutoverStage,
  RunLotCutoverInput,
} from "./lot-cutover-types.js";
import { SHA_PATTERN, UUID_PATTERN } from "./lot-cutover-types.js";

type CutoverTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function recordStage(
  tx: CutoverTx, workspaceId: string, stage: LotCutoverStage, detail: unknown,
): Promise<void> {
  await tx.insert(lotCutoverEvents).values({
    workspaceId, stage, detail: (detail ?? {}) as Record<string, unknown>,
  });
}
export async function runLotCutover(
  db: Database, input: RunLotCutoverInput, safety: CutoverSafety,
): Promise<LotCutoverReceipt> {
  if (input.confirmCutover !== true) throw new FacetError(400, "invalid_facet_command");
  if (!UUID_PATTERN.test(input.workspaceId) || !UUID_PATTERN.test(input.importKey)) {
    throw new FacetError(400, "invalid_facet_command");
  }
  if (!SHA_PATTERN.test(input.report.manifestSha256)) {
    throw new FacetError(400, "invalid_facet_command");
  }
  const gate = await evaluateActivationGate(db, input.workspaceId, input.report);
  if (!gate.activatable) {
    throw new FacetError(409, gate.reasons[0] ?? "lot_cutover_blocked");
  }
  await db.transaction(async (tx) => {
    await lockWorkspace(tx, input.workspaceId);
    await tx.execute(sql`LOCK TABLE prospect_marks IN SHARE ROW EXCLUSIVE MODE`);
    await tx.execute(sql`UPDATE lot_legacy_fence SET enabled = true WHERE singleton`);
    await approvedAccountId(tx, input.actorSub, true);
    const access = await resolveWorkspaceAccess(tx, input.workspaceId, input.actorSub);
    if (!access.moderateArchive) throw new FacetError(403, "workspace_capability_required");
    const [current] = await tx.select().from(lotCutoverState)
      .where(eq(lotCutoverState.workspaceId, input.workspaceId));
    if (current?.destinationOpen === true) {
      throw new FacetError(409, "lot_cutover_already_open");
    }
    await tx.insert(lotCutoverState).values({
      workspaceId: input.workspaceId, maintenanceBarrier: true,
      manifestSha: input.report.manifestSha256,
    }).onConflictDoUpdate({
      target: [lotCutoverState.workspaceId],
      set: { maintenanceBarrier: true, manifestSha: input.report.manifestSha256 },
    });
    await recordStage(tx, input.workspaceId, "commit-barrier",
      { manifestSha: input.report.manifestSha256 });
  });
  const completed = await db.transaction(async (tx) => {
    await lockWorkspace(tx, input.workspaceId);
    const [current] = await tx.select().from(lotCutoverState)
      .where(eq(lotCutoverState.workspaceId, input.workspaceId));
    if (current?.destinationOpen === true) {
      throw new FacetError(409, "lot_cutover_already_open");
    }
    if (current?.maintenanceBarrier !== true) {
      throw new FacetError(409, "lot_cutover_barrier_missing");
    }
    const doneStages: LotCutoverStage[] = [];
    const done = async (stage: LotCutoverStage, detail: unknown) => {
      await recordStage(tx, input.workspaceId, stage, detail);
      doneStages.push(stage);
    };
    retireLegacyMarkDelivery();
    await done("stop-publishers", { retired: ["prospect:mark", "prospect:batch"] });
    await done("close-readers", { legacy: "fenced" });
    retireLegacyMarkDelivery();
    await safety.drainDeliveryPaths(input.workspaceId);
    await done("destroy-buffers", { drained: true });
    await tx.execute(sql`LOCK TABLE prospect_marks, lot_versions IN SHARE MODE`);
    const fresh = await input.recomputeManifest();
    if (fresh.manifestSha256 !== input.report.manifestSha256) {
      throw new FacetError(409, "lot_manifest_drift");
    }
    await done("recompute-manifest", { manifestSha: fresh.manifestSha256 });
    const currentGate = await evaluateActivationGate(tx as unknown as Database, input.workspaceId, fresh);
    if (!currentGate.activatable) throw new FacetError(409, currentGate.reasons[0] ?? "lot_cutover_blocked");
    const receipt = await runLotImport(tx as unknown as Database, {
      workspaceId: input.workspaceId, actorSub: input.actorSub,
      report: input.report, importKey: input.importKey,
    }, { enabled: true, activatedSourceIds: new Set(currentGate.activatedSourceIds),
      eligibleTargetKeys: new Set(currentGate.ready) });
    const expectedHeads = fresh.rows.filter((row) => isProjectableHead(row, true,
      new Set(currentGate.activatedSourceIds), new Set(currentGate.ready))).length;
    if (receipt.counts.sourceRows !== input.report.rows.length
      || receipt.counts.projected + receipt.counts.alreadyProjected !== expectedHeads) {
      throw new FacetError(409, "lot_cutover_accounting_mismatch");
    }
    await done("reconcile-heads", { counts: receipt.counts });
    const [destination] = await tx.select().from(lotDestinationState)
      .where(eq(lotDestinationState.workspaceId, input.workspaceId));
    if (!destination || typeof destination.selectionBasket !== "string"
      || destination.selectionBasket === "") {
      throw new FacetError(409, "lot_destination_unconfigured");
    }
    await tx.insert(lotDestinationState).values({
      workspaceId: input.workspaceId, enabled: true,
      selectionBasket: destination.selectionBasket,
    }).onConflictDoUpdate({
      target: [lotDestinationState.workspaceId],
      set: { enabled: true },
    });
    await done("switch-authority", { selectionBasket: destination.selectionBasket });
    return doneStages;
  });
  const opened = await openLotDestination(db, input, safety);
  const stages = ["commit-barrier", ...completed, ...opened] as LotCutoverStage[];
  return {
    status: "complete",
    workspaceId: input.workspaceId,
    manifestSha: input.report.manifestSha256,
    stages,
    counts: {
      ready: gate.ready.length,
      pending: gate.pending.length,
      unavailable: gate.unavailable.length,
    },
    pending: gate.pending,
  };
}
