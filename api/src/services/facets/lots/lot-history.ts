/**
 * 6J lot history: scoped, paginated destination and source navigation.
 *
 * Destination history walks the bound events of every lot stream of one
 * target and mode, newest first, with opaque offsets. Source history
 * replays the preserved import evidence chain (exact values and chain
 * links) without ever promoting it to current state. History stays
 * queryable through this contract; sealed source evidence is never a
 * current-state fallback.
 */
import { and, asc, desc, eq, or } from "drizzle-orm";
import type { Database } from "../../../db/client.js";
import {
  facetEvents,
  facetEventBindings,
  facetStreams,
  lotSourceRows,
} from "../../../db/schema.js";
import { approvedAccountId, resolveWorkspaceAccess } from "../../workspaces/store.js";
import { lockWorkspace } from "../../workspaces/mutations.js";
import { requireScopedEpoch } from "../scope.js";
import { scopedEpochFor } from "../activation.js";
import { FacetError } from "../target.js";
import type { DestinationProjection } from "../lot-migration-report/manifest.js";
import type { LotMode, LotTarget } from "./lot-target.js";
import { resolveLotRights } from "./lot-capabilities.js";
import { requireOpenLotDestination } from "./lot-gate.js";
import { lotEventResponse, type LotEventSnapshot } from "./lot-response.js";

export interface LotHistoryPage {
  target: LotTarget;
  mode: LotMode;
  events: LotEventSnapshot[];
  nextOffset: number | null;
}

export interface LotSourceHistoryPage {
  target: LotTarget | null;
  mode: LotMode | null;
  chainId: string;
  rows: Array<{
    sourceId: string;
    chainId: string;
    nativeTarget: string;
    disposition: string;
    diagnostics: string[];
    destination: unknown;
    observed: unknown;
  }>;
  nextOffset: number | null;
}

/**
 * Reverse navigation: when every row of the chain carries the same
 * destination, expose its stable target (with mode implied by the
 * destination) so the client can reach destination history without
 * reading the import manifest. Uniqueness is judged over the whole
 * chain, never over one page. Mixed or destination-less chains stay
 * ambiguous and return null.
 */
function singleDestinationTarget(
  destinations: unknown[],
): { target: LotTarget | null; mode: LotMode | null } {
  let target: LotTarget | null = null;
  let mode: LotMode | null = null;
  for (const destination of destinations) {
    const projection = destination as DestinationProjection | null;
    if (!projection || typeof projection !== "object") return { target: null, mode: null };
    const candidate: LotTarget = { type: "Lot", authority: "lot_versions",
      citySlug: projection.citySlug, canonicalId: projection.canonicalTarget };
    if (!target) {
      target = candidate;
      mode = projection.mode;
    } else if (target.citySlug !== candidate.citySlug
      || target.canonicalId !== candidate.canonicalId || mode !== projection.mode) {
      return { target: null, mode: null };
    }
  }
  return { target, mode };
}

function assertPage(offset: number, limit: number): void {
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new FacetError(400, "invalid_facet_command");
  }
}

/** Destination events for one target and mode, newest first. */
export async function readLotHistory(
  db: Database, sub: string, workspaceId: string, mode: LotMode,
  target: LotTarget, offset: number, limit: number,
): Promise<LotHistoryPage> {
  assertPage(offset, limit);
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    const accountId = await approvedAccountId(tx, sub, true);
    await resolveWorkspaceAccess(tx, workspaceId, sub);
    await resolveLotRights(tx, workspaceId, sub);
    await requireOpenLotDestination(tx, workspaceId);
    requireScopedEpoch(await scopedEpochFor(tx, workspaceId), workspaceId);
    const rows = await tx.select({ event: facetEvents })
      .from(facetEventBindings)
      .innerJoin(facetEvents, eq(facetEvents.id, facetEventBindings.eventId))
      .innerJoin(facetStreams, eq(facetStreams.id, facetEventBindings.streamId))
      .where(and(
        eq(facetStreams.workspaceId, workspaceId),
        eq(facetStreams.targetType, "lot"),
        eq(facetStreams.mode, mode),
        eq(facetStreams.citySlug, target.citySlug),
        eq(facetStreams.nodeType, "Lot"),
        eq(facetStreams.nodeId, target.canonicalId),
        or(eq(facetStreams.scope, "workspace"), eq(facetStreams.ownerId, accountId)),
      ))
      .orderBy(desc(facetEvents.createdAt), desc(facetEvents.id))
      .limit(limit + 1)
      .offset(offset);
    const visible = rows.map(({ event }) => lotEventResponse(event));
    return {
      target,
      mode,
      events: visible.slice(0, limit),
      nextOffset: rows.length > limit ? offset + limit : null,
    };
  });
}

/** Preserved source evidence for one chain, import order. */
export async function readLotSourceHistory(
  db: Database, sub: string, workspaceId: string,
  chainId: string, offset: number, limit: number,
): Promise<LotSourceHistoryPage> {
  assertPage(offset, limit);
  if (chainId === "") throw new FacetError(400, "invalid_facet_command");
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    await approvedAccountId(tx, sub, true);
    await resolveWorkspaceAccess(tx, workspaceId, sub);
    await requireOpenLotDestination(tx, workspaceId);
    requireScopedEpoch(await scopedEpochFor(tx, workspaceId), workspaceId);
    const chain = await tx.select({ destination: lotSourceRows.destination })
      .from(lotSourceRows).where(and(
        eq(lotSourceRows.workspaceId, workspaceId),
        eq(lotSourceRows.chainId, chainId),
      ));
    const destination = singleDestinationTarget(chain.map((row) => row.destination));
    const rows = await tx.select().from(lotSourceRows).where(and(
      eq(lotSourceRows.workspaceId, workspaceId),
      eq(lotSourceRows.chainId, chainId),
    )).orderBy(asc(lotSourceRows.sourceId)).limit(limit + 1).offset(offset);
    const page = rows.slice(0, limit);
    return {
      target: destination.target,
      mode: destination.mode,
      chainId,
      rows: page.map((row) => ({
        sourceId: row.sourceId,
        chainId: row.chainId,
        nativeTarget: row.nativeTarget,
        disposition: row.disposition,
        diagnostics: [...(row.diagnostics ?? [])],
        destination: row.destination,
        observed: row.observed,
      })),
      nextOffset: rows.length > limit ? offset + limit : null,
    };
  });
}
