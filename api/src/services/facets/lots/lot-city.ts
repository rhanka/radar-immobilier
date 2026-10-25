/**
 * 6J lot collection projection for map indicators and counters.
 *
 * One row per target in a city and mode, with independent facet heads.
 * Another member's personal state never appears; lots without a qualified
 * target stay readable with business mutation unavailable.
 */
import { and, eq } from "drizzle-orm";
import type { Database } from "../../../db/client.js";
import {
  facetEvents,
  facetHeads,
  facetStreams,
} from "../../../db/schema.js";
import { approvedAccountId, resolveWorkspaceAccess } from "../../workspaces/store.js";
import { lockWorkspace } from "../../workspaces/mutations.js";
import { requireScopedEpoch } from "../scope.js";
import { scopedEpochFor } from "../activation.js";
import { FacetError } from "../target.js";
import type { LotMode, LotTarget } from "./lot-target.js";
import { resolveLotRights } from "./lot-capabilities.js";
import { requireOpenLotDestination } from "./lot-gate.js";
import {
  isCutoverBlockedTarget,
  readBlockedCutoverKeys,
} from "./lot-cutover-target.js";
import { lotEventResponse, type LotEventSnapshot } from "./lot-response.js";
import {
  isEffectivelyDiscarded,
  type LotArchiveHead,
  type LotSelectionHead,
} from "./lot-reader.js";

export interface LotCityHead {
  target: LotTarget;
  selection: LotSelectionHead[];
  archive: {
    personal: LotArchiveHead | null;
    workspace: LotArchiveHead | null;
    effectiveDiscarded: boolean;
  };
  pipeline: LotEventSnapshot | null;
  market: LotEventSnapshot | null;
}

/** Authorized collection projection for map indicators and counters. */
export async function readLotCity(
  db: Database, sub: string, workspaceId: string, mode: LotMode, citySlug: string,
): Promise<{ citySlug: string; mode: LotMode; heads: LotCityHead[] }> {
  if (citySlug === "") throw new FacetError(400, "invalid_facet_command");
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    const accountId = await approvedAccountId(tx, sub, true);
    await resolveWorkspaceAccess(tx, workspaceId, sub);
    await resolveLotRights(tx, workspaceId, sub);
    await requireOpenLotDestination(tx, workspaceId);
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
    const byTarget = new Map<string, LotCityHead>();
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
        const head: LotArchiveHead = { ...lotEventResponse(event), scope,
          changedSinceArchive: null };
        if (scope === "workspace") entry.archive.workspace = head;
        else entry.archive.personal = head;
        entry.archive.effectiveDiscarded = isEffectivelyDiscarded(
          entry.archive.personal, entry.archive.workspace);
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
