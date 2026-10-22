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
import type { LotMode, LotTarget } from "./lot-target.js";
import { resolveLotRights } from "./lot-capabilities.js";
import { requireLotDestination } from "./lot-gate.js";
import { lotEventResponse, type LotEventSnapshot } from "./lot-response.js";

export interface LotHistoryPage {
  target: LotTarget;
  mode: LotMode;
  events: LotEventSnapshot[];
  nextOffset: number | null;
}

export interface LotSourceHistoryPage {
  target: LotTarget | null;
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
    await requireLotDestination(tx, workspaceId);
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
    await requireLotDestination(tx, workspaceId);
    requireScopedEpoch(await scopedEpochFor(tx, workspaceId), workspaceId);
    const rows = await tx.select().from(lotSourceRows).where(and(
      eq(lotSourceRows.workspaceId, workspaceId),
      eq(lotSourceRows.chainId, chainId),
    )).orderBy(asc(lotSourceRows.sourceId)).limit(limit + 1).offset(offset);
    const page = rows.slice(0, limit);
    return {
      target: null,
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
