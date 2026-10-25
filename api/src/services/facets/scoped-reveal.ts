import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { facetEventBindings, facetEvents, facetReasonCodes, graphNodes } from "../../db/schema.js";
import { approvedAccountId, resolveWorkspaceAccess } from "../workspaces/store.js";
import { lockWorkspace } from "../workspaces/mutations.js";
import { requireScopedEpoch, ScopeError } from "./scope.js";
import { scopedEpochFor } from "./activation.js";
import { FACET_PROFILE } from "./codebook.js";
import { FacetError, targetFingerprint, type SignalTarget } from "./target.js";
import { workspaceStreamHead } from "./workspace-streams.js";
import { isEffectivelyDiscarded, toWorkspaceArchiveHead } from "./workspace-reader.js";

export async function readScopedReasonCodes(
  db: Database, sub: string, workspaceId: string,
) {
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    await approvedAccountId(tx, sub, true);
    await resolveWorkspaceAccess(tx, workspaceId, sub);
    requireScopedEpoch(await scopedEpochFor(tx, workspaceId), workspaceId);
    return tx.select({
      code: facetReasonCodes.code, verdict: facetReasonCodes.verdict,
    }).from(facetReasonCodes).where(eq(facetReasonCodes.profileId, FACET_PROFILE))
      .orderBy(facetReasonCodes.verdict, facetReasonCodes.code);
  });
}

export async function readScopedReveal(
  db: Database, sub: string, workspaceId: string, target: SignalTarget,
) {
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
    const [node] = await tx.select().from(graphNodes).where(and(
      eq(graphNodes.citySlug, target.citySlug),
      eq(graphNodes.type, target.type), eq(graphNodes.id, target.id)));
    if (!node) throw new FacetError(404, "signal_not_found");
    const [personalRow, workspaceRow] = await Promise.all([
      workspaceStreamHead(tx, workspaceId, "personal", accountId, target),
      workspaceStreamHead(tx, workspaceId, "workspace", null, target),
    ]);
    const personal = personalRow ? toWorkspaceArchiveHead(personalRow.event, personalRow.node) : null;
    const workspace = workspaceRow ? toWorkspaceArchiveHead(workspaceRow.event, workspaceRow.node) : null;
    return {
      target,
      signal: { id: node.id, type: node.type, label: node.label,
        citySlug: node.citySlug, sourceRef: node.sourceRef, props: node.props,
        createdAt: node.createdAt ? node.createdAt.toISOString() : null },
      displayedFingerprint: targetFingerprint(node),
      heads: { personal, workspace },
      effectiveDiscarded: isEffectivelyDiscarded(personal, workspace),
      capabilities: { discardPersonally: true, moderateArchive: access.moderateArchive },
    };
  });
}
