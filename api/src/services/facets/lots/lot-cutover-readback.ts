/**
 * 6K internal cutover readback: authorized, barrier-bound verification.
 *
 * Public lot reads require an open destination; this reader stays
 * available while the destination is still closed so the cutover can
 * verify committed heads before opening. It is never mounted on a
 * route and takes no public bypass input: actor, workspace membership
 * with moderation, configured destination, scoped epoch and the
 * committed maintenance barrier are all rechecked on every call.
 */
import { and, eq } from "drizzle-orm";
import type { Database } from "../../../db/client.js";
import {
  facetEvents,
  facetHeads,
  facetStreams,
  lotCutoverState,
} from "../../../db/schema.js";
import { lockWorkspace } from "../../workspaces/mutations.js";
import { approvedAccountId, resolveWorkspaceAccess } from "../../workspaces/store.js";
import { requireScopedEpoch } from "../scope.js";
import { scopedEpochFor } from "../activation.js";
import { FacetError } from "../target.js";
import type { LotMode, LotTarget } from "./lot-target.js";
import { requireLotDestination } from "./lot-gate.js";
import {
  isCutoverBlockedTarget,
  readBlockedCutoverKeys,
} from "./lot-cutover-target.js";
import { lotEventResponse, type LotEventSnapshot } from "./lot-response.js";

export interface CutoverReadbackArchive {
  personal: (LotEventSnapshot & { scope: "personal" | "workspace" }) | null;
  workspace: (LotEventSnapshot & { scope: "personal" | "workspace" }) | null;
  effectiveDiscarded: boolean;
}

export interface CutoverReadbackHead {
  target: LotTarget;
  selection: Array<LotEventSnapshot & { scope: "personal" | "workspace" }>;
  archive: CutoverReadbackArchive;
  pipeline: LotEventSnapshot | null;
  market: LotEventSnapshot | null;
}

/** Authorized internal readback for one city and mode under the barrier. */
export async function readLotCutoverReadback(
  db: Database, actorSub: string, workspaceId: string, mode: LotMode, citySlug: string,
): Promise<{ citySlug: string; mode: LotMode; heads: CutoverReadbackHead[] }> {
  if (citySlug === "") throw new FacetError(400, "invalid_facet_command");
  if (mode !== "real" && mode !== "simulation") throw new FacetError(400, "invalid_facet_command");
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    const accountId = await approvedAccountId(tx, actorSub, true);
    const access = await resolveWorkspaceAccess(tx, workspaceId, actorSub);
    if (!access.moderateArchive) throw new FacetError(403, "workspace_capability_required");
    const [state] = await tx.select().from(lotCutoverState)
      .where(eq(lotCutoverState.workspaceId, workspaceId));
    if (!state || state.maintenanceBarrier !== true) {
      throw new FacetError(409, "lot_cutover_barrier_missing");
    }
    await requireLotDestination(tx, workspaceId);
    requireScopedEpoch(await scopedEpochFor(tx, workspaceId), workspaceId);
    const blocked = await readBlockedCutoverKeys(tx as unknown as Database, workspaceId);
    const rows = await tx.select({ event: facetEvents })
      .from(facetStreams)
      .innerJoin(facetHeads, eq(facetHeads.streamId, facetStreams.id))
      .innerJoin(facetEvents, eq(facetEvents.id, facetHeads.eventId))
      .where(and(
        eq(facetStreams.workspaceId, workspaceId),
        eq(facetStreams.targetType, "lot"),
        eq(facetStreams.mode, mode),
        eq(facetStreams.citySlug, citySlug),
      ));
    const byTarget = new Map<string, CutoverReadbackHead>();
    for (const { event } of rows) {
      if (event.scope === "personal" && event.ownerId !== accountId) continue;
      const target: LotTarget = { type: "Lot", authority: "lot_versions",
        citySlug: event.citySlug, canonicalId: event.nodeId };
      if (isCutoverBlockedTarget(blocked, target, mode)) continue;
      const key = JSON.stringify([target.citySlug, target.canonicalId]);
      const entry = byTarget.get(key) ?? {
        target,
        selection: [],
        archive: { personal: null, workspace: null, effectiveDiscarded: false },
        pipeline: null,
        market: null,
      };
      const scope = event.scope as "personal" | "workspace";
      if (event.facet === "selection") {
        entry.selection.push({ ...lotEventResponse(event), scope });
      } else if (event.facet === "archive") {
        const head = { ...lotEventResponse(event), scope, changedSinceArchive: null } as unknown as
          LotEventSnapshot & { scope: "personal" | "workspace" };
        if (scope === "workspace") entry.archive.workspace = head;
        else entry.archive.personal = head;
        entry.archive.effectiveDiscarded =
          entry.archive.personal?.state === "active" || entry.archive.workspace?.state === "active";
      } else if (event.facet === "pipeline") {
        entry.pipeline = lotEventResponse(event);
      } else if (event.facet === "market") {
        entry.market = lotEventResponse(event);
      }
      byTarget.set(key, entry);
    }
    return {
      citySlug,
      mode,
      heads: [...byTarget.values()].sort((left, right) =>
        left.target.canonicalId.localeCompare(right.target.canonicalId)),
    };
  });
}
