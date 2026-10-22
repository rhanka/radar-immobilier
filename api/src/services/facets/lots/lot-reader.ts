/**
 * 6J lot reader: authorized target, source version, and independent facet
 * states.
 *
 * Selection, archive, pipeline, and market heads are returned separately;
 * one facet never implies another. Inactive heads stay present. Market
 * heads carry the exact decimal price and listing URL; archive heads carry
 * reason provenance and changed-since-archive information. A personal
 * restoration may leave the target hidden by the workspace; a workspace
 * restoration leaves the viewer's personal hiding intact.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../../../db/client.js";
import {
  facetEventBindings,
  facetEvents,
  facetHeads,
  facetStreams,
  lotVersions,
} from "../../../db/schema.js";
import { approvedAccountId, resolveWorkspaceAccess } from "../../workspaces/store.js";
import { lockWorkspace } from "../../workspaces/mutations.js";
import { requireScopedEpoch, ScopeError } from "../scope.js";
import { scopedEpochFor } from "../activation.js";
import { FacetError } from "../target.js";
import {
  lotFingerprint,
  resolveLotSource,
  type DisplayedLotVersion,
  type LotMode,
  type LotTarget,
} from "./lot-target.js";
import { resolveLotRights } from "./lot-capabilities.js";
import { requireLotDestination } from "./lot-gate.js";
import { lotEventResponse, type LotEventSnapshot } from "./lot-response.js";

export interface LotArchiveHead extends LotEventSnapshot {
  scope: "personal" | "workspace";
  changedSinceArchive: boolean | null;
}

export interface LotSelectionHead extends LotEventSnapshot {
  scope: "personal" | "workspace";
}

export interface LotArchiveState {
  personal: LotArchiveHead | null;
  workspace: LotArchiveHead | null;
  effectiveDiscarded: boolean;
}

export interface LotReadState {
  target: LotTarget;
  mode: LotMode;
  targetAvailable: boolean;
  displayed_version: DisplayedLotVersion | null;
  selection: LotSelectionHead[];
  archive: LotArchiveState;
  pipeline: LotEventSnapshot | null;
  market: LotEventSnapshot | null;
  capabilities: {
    select: boolean;
    changePipeline: boolean;
    changeMarket: boolean;
    discardPersonally: boolean;
    moderateArchive: boolean;
  };
}

export function isEffectivelyDiscarded(
  personal: { state: string } | null, workspace: { state: string } | null,
): boolean {
  return personal?.state === "active" || workspace?.state === "active";
}

type LotTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

type HeadSnapshot = (LotSelectionHead | LotArchiveHead) & { facet: string };

async function readLotHeadSnapshots(
  tx: LotTx, workspaceId: string, accountId: string, mode: LotMode, target: LotTarget,
): Promise<HeadSnapshot[]> {
  const rows = await tx.select({ event: facetEvents })
    .from(facetStreams)
    .innerJoin(facetHeads, eq(facetHeads.streamId, facetStreams.id))
    .innerJoin(facetEvents, eq(facetEvents.id, facetHeads.eventId))
    .where(and(
      eq(facetStreams.workspaceId, workspaceId),
      eq(facetStreams.targetType, "lot"),
      eq(facetStreams.mode, mode),
      eq(facetStreams.citySlug, target.citySlug),
      eq(facetStreams.nodeType, "Lot"),
      eq(facetStreams.nodeId, target.canonicalId),
    ));
  const snapshots: HeadSnapshot[] = [];
  for (const { event } of rows) {
    if (event.scope === "personal" && event.ownerId !== accountId) continue;
    const scope = event.scope as "personal" | "workspace";
    if (event.facet === "selection") {
      snapshots.push({ ...lotEventResponse(event), scope });
    } else if (event.facet === "archive") {
      snapshots.push({
        ...lotEventResponse(event),
        scope,
        changedSinceArchive: event.state === "active"
          ? await changedSinceArchive(tx, event)
          : null,
      });
    } else {
      snapshots.push({ ...lotEventResponse(event), scope });
    }
  }
  return snapshots.sort((left, right) =>
    left.facet.localeCompare(right.facet) || (left.basket ?? "").localeCompare(right.basket ?? ""));
}

async function changedSinceArchive(
  tx: LotTx, event: typeof facetEvents.$inferSelect,
): Promise<boolean | null> {
  if (event.observedLotVersion === null) return null;
  const [row] = await tx.select().from(lotVersions)
    .where(eq(lotVersions.id, event.observedLotVersion));
  if (!row) return null;
  return lotFingerprint(row) !== event.observedFingerprint;
}

async function assertNoUnresolvedPersonalHistory(tx: LotTx, accountId: string): Promise<void> {
  const [unresolved] = await tx.select({ id: facetEvents.id }).from(facetEvents)
    .leftJoin(facetEventBindings, eq(facetEventBindings.eventId, facetEvents.id))
    .where(and(
      eq(facetEvents.ownerId, accountId),
      eq(facetEvents.targetType, "lot"),
      isNull(facetEventBindings.eventId))).limit(1);
  if (unresolved) throw new ScopeError(503, "personal_history_unresolved");
}
