/**
 * 6I workspace archive reader: personal and workspace heads stay separate.
 *
 * One workspace stream holds the common archive; every viewer keeps an
 * independent personal stream. Effective hiding is the union of both
 * active archives, so restoring a personal archive can never lift a
 * workspace archive. Another member's personal state never appears here:
 * only the viewer's own personal stream and the workspace stream are
 * read. Before activation the scope stays unavailable (503); legacy
 * readers keep serving unchanged behavior.
 */
import { and, eq, isNull, or } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import {
  facetEvents,
  facetHeads,
  facetStreams,
  facetEventBindings,
  graphNodes,
} from "../../db/schema.js";
import { approvedAccountId, resolveWorkspaceAccess } from "../workspaces/store.js";
import { lockWorkspace } from "../workspaces/mutations.js";
import { targetFingerprint, type SignalTarget } from "./target.js";
import { facetEventResponse } from "./response.js";
import { requireScopedEpoch, ScopeError } from "./scope.js";
import { scopedEpochFor } from "./activation.js";
import { workspaceStreamHead } from "./workspace-streams.js";

export interface WorkspaceArchiveHead {
  id: string;
  target: { citySlug: string; type: string; id: string };
  facet: string;
  basket: string | null;
  state: string;
  reasonCode: string | null;
  verdict: string | null;
  createdAt: string;
  targetAvailable: boolean;
  changedSinceArchive: boolean | null;
}

export interface WorkspaceArchiveState {
  target: SignalTarget;
  personal: WorkspaceArchiveHead | null;
  workspace: WorkspaceArchiveHead | null;
  effectiveDiscarded: boolean;
  capabilities: { discardPersonally: boolean; moderateArchive: boolean };
}

/** Effective hiding: an active archive in either scope hides the target. */
export function isEffectivelyDiscarded(
  personal: { state: string } | null, workspace: { state: string } | null,
): boolean {
  return personal?.state === "active" || workspace?.state === "active";
}

export function toWorkspaceArchiveHead(
  event: typeof facetEvents.$inferSelect, node: typeof graphNodes.$inferSelect | null,
): WorkspaceArchiveHead {
  return {
    ...facetEventResponse(event),
    targetAvailable: node !== null,
    changedSinceArchive: event.facet === "archive" && event.state === "active" && node !== null
      ? event.observedFingerprint !== targetFingerprint(node) : null,
  };
}

/** Read one target: separate personal and workspace heads plus capabilities. */
export async function readWorkspaceArchiveState(
  db: Database, sub: string, workspaceId: string, target: SignalTarget,
): Promise<WorkspaceArchiveState> {
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    const accountId = await approvedAccountId(tx, sub, true);
    const access = await resolveWorkspaceAccess(tx, workspaceId, sub);
    requireScopedEpoch(await scopedEpochFor(tx, workspaceId), workspaceId);
    const [unresolved] = await tx.select({ id: facetEvents.id }).from(facetEvents)
      .leftJoin(facetEventBindings, eq(facetEventBindings.eventId, facetEvents.id))
      .where(and(eq(facetEvents.ownerId, accountId),
        isNull(facetEventBindings.eventId))).limit(1);
    if (unresolved) throw new ScopeError(503, "personal_history_unresolved");
    const [personalRow, workspaceRow] = await Promise.all([
      workspaceStreamHead(tx, workspaceId, "personal", accountId, target),
      workspaceStreamHead(tx, workspaceId, "workspace", null, target),
    ]);
    const personal = personalRow ? toWorkspaceArchiveHead(personalRow.event, personalRow.node) : null;
    const workspace = workspaceRow ? toWorkspaceArchiveHead(workspaceRow.event, workspaceRow.node) : null;
    return {
      target,
      personal,
      workspace,
      effectiveDiscarded: isEffectivelyDiscarded(personal, workspace),
      capabilities: { discardPersonally: true, moderateArchive: access.moderateArchive },
    };
  });
}

/** City projection: one row per archived target with both scopes separated. */
export async function readWorkspaceArchiveCity(
  db: Database, sub: string, workspaceId: string, city: string,
): Promise<WorkspaceArchiveState[]> {
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    const accountId = await approvedAccountId(tx, sub, true);
    const access = await resolveWorkspaceAccess(tx, workspaceId, sub);
    requireScopedEpoch(await scopedEpochFor(tx, workspaceId), workspaceId);
    const [unresolved] = await tx.select({ id: facetEvents.id }).from(facetEvents)
      .leftJoin(facetEventBindings, eq(facetEventBindings.eventId, facetEvents.id))
      .where(and(eq(facetEvents.ownerId, accountId),
        isNull(facetEventBindings.eventId))).limit(1);
    if (unresolved) throw new ScopeError(503, "personal_history_unresolved");
    const rows = await tx.select({ event: facetEvents, node: graphNodes })
      .from(facetStreams)
      .innerJoin(facetHeads, eq(facetHeads.streamId, facetStreams.id))
      .innerJoin(facetEvents, eq(facetEvents.id, facetHeads.eventId))
      .leftJoin(graphNodes, and(eq(graphNodes.citySlug, facetEvents.citySlug),
        eq(graphNodes.type, facetEvents.nodeType), eq(graphNodes.id, facetEvents.nodeId)))
      .where(and(eq(facetStreams.workspaceId, workspaceId),
        or(eq(facetStreams.scope, "workspace"), and(eq(facetStreams.scope, "personal"),
          eq(facetStreams.ownerId, accountId))),
        eq(facetStreams.citySlug, city), eq(facetStreams.facet, "archive"),
        isNull(facetStreams.basket)));
    const byTarget = new Map<string, WorkspaceArchiveState>();
    const capabilities = { discardPersonally: true, moderateArchive: access.moderateArchive };
    for (const row of rows) {
      const target = { citySlug: row.event.citySlug,
        type: row.event.nodeType as SignalTarget["type"], id: row.event.nodeId };
      const entry: WorkspaceArchiveState =
        byTarget.get(JSON.stringify([target.citySlug, target.type, target.id])) ?? {
          target, personal: null, workspace: null, effectiveDiscarded: false, capabilities,
        };
      if (row.event.scope === "workspace") {
        entry.workspace = toWorkspaceArchiveHead(row.event, row.node);
      } else if (row.event.ownerId === accountId) {
        entry.personal = toWorkspaceArchiveHead(row.event, row.node);
      }
      entry.effectiveDiscarded = isEffectivelyDiscarded(entry.personal, entry.workspace);
      byTarget.set(JSON.stringify([target.citySlug, target.type, target.id]), entry);
    }
    return [...byTarget.values()].sort((left, right) =>
      left.target.type.localeCompare(right.target.type)
      || left.target.id.localeCompare(right.target.id));
  });
}
