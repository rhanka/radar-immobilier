/** Final readback and opening remain separate from reconciliation commits. */
import { eq, sql } from "drizzle-orm";
import type { Database } from "../../../db/client.js";
import { lotCutoverEvents, lotCutoverState } from "../../../db/schema.js";
import { lockWorkspace } from "../../workspaces/mutations.js";
import { approvedAccountId, resolveWorkspaceAccess } from "../../workspaces/store.js";
import { FacetError } from "../target.js";
import { evaluateActivationGate } from "./lot-cutover-gate.js";
import type { CutoverSafety, LotCutoverStage, RunLotCutoverInput } from "./lot-cutover-types.js";

export async function openLotDestination(
  db: Database, input: RunLotCutoverInput, safety: CutoverSafety,
): Promise<LotCutoverStage[]> {
  await safety.readbackAuthorized(input.workspaceId);
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, input.workspaceId);
    const [current] = await tx.select().from(lotCutoverState)
      .where(eq(lotCutoverState.workspaceId, input.workspaceId));
    if (current?.destinationOpen === true) throw new FacetError(409, "lot_cutover_already_open");
    if (current?.maintenanceBarrier !== true) throw new FacetError(409, "lot_cutover_barrier_missing");
    await approvedAccountId(tx, input.actorSub, true);
    const access = await resolveWorkspaceAccess(tx, input.workspaceId, input.actorSub);
    if (!access.moderateArchive) throw new FacetError(403, "workspace_capability_required");
    await tx.execute(sql`LOCK TABLE prospect_marks, lot_versions IN SHARE MODE`);
    const fresh = await input.recomputeManifest();
    if (fresh.manifestSha256 !== input.report.manifestSha256) throw new FacetError(409, "lot_manifest_drift");
    const gate = await evaluateActivationGate(tx as unknown as Database, input.workspaceId, fresh);
    if (!gate.activatable) throw new FacetError(409, gate.reasons[0] ?? "lot_cutover_blocked");
    await tx.insert(lotCutoverEvents).values({ workspaceId: input.workspaceId,
      stage: "verify-reads", detail: { verified: true } });
    await tx.insert(lotCutoverState).values({
      workspaceId: input.workspaceId, maintenanceBarrier: true,
      destinationOpen: true, manifestSha: input.report.manifestSha256, activatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [lotCutoverState.workspaceId],
      set: { maintenanceBarrier: true, destinationOpen: true,
        manifestSha: input.report.manifestSha256, activatedAt: new Date() },
    });
    await tx.insert(lotCutoverEvents).values({ workspaceId: input.workspaceId,
      stage: "open-destination", detail: { manifestSha: input.report.manifestSha256, openedTargets: gate.ready } });
    return ["verify-reads", "open-destination"];
  });
}
