/**
 * 6H activation state and chain qualification.
 *
 * A chain binds only when it is single-headed, reciprocal, and acyclic
 * within one stream. Anything else stays sealed: partial binding,
 * cross-stream linkage, orphan heads, and new unbound events are rejected.
 */
import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import {
  facetActivationState,
  facetCommandContexts,
  facetCommands,
  facetEventBindings,
  facetStreams,
  facetStreamAttachments,
} from "../../db/schema.js";
import { SCOPED_EPOCH } from "./scope.js";

type ActivationTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function attachedAccounts(tx: ActivationTx, workspaceId: string) {
  return tx.select().from(facetStreamAttachments).where(and(
    eq(facetStreamAttachments.workspaceId, workspaceId),
    eq(facetStreamAttachments.status, "attached")));
}

export interface ActivationInput {
  workspaceId: string;
  actorSub: string;
  reason: string;
}

/** Deployment supplies these only after retiring every incompatible delivery path. */
export interface ActivationSafety {
  drain(workspaceId: string): Promise<void>;
  readback(workspaceId: string): Promise<void>;
}

export interface ActivationReceipt {
  workspaceId: string;
  streamsBound: number;
  headsRegistered: number;
  sealedUnresolved: Array<{ ownerId: string; cause: string }>;
  pendingReceipts: number;
  epoch: typeof SCOPED_EPOCH;
}

export async function scopedEpochFor(
  db: Pick<Database, "select">, workspaceId: string,
): Promise<string | null> {
  const [row] = await db.select().from(facetActivationState)
    .where(eq(facetActivationState.workspaceId, workspaceId));
  return row?.maintenanceBarrier ? null : row?.writerEpoch ?? null;
}

export interface ChainEvent {
  id: string;
  ownerId: string;
  citySlug: string;
  nodeType: string;
  nodeId: string;
  facet: string;
  basket: string | null;
  supersedes: string | null;
  supersededBy: string | null;
}

/**
 * Context-unresolved null-result receipts stay pending: the key remains
 * reserved and returns `command_context_unresolved`, never a new command.
 */
export async function sealPendingReceiptContexts(
  tx: ActivationTx, workspaceId: string, accountId: string,
): Promise<void> {
  const receipts = await tx.select().from(facetCommands)
    .where(eq(facetCommands.ownerId, accountId));
  for (const receiptRow of receipts) {
    const stored = receiptRow.result as { event: { id: string } | null; context?: unknown };
    const binding = stored.event === null ? [] : await tx.select({ workspaceId: facetStreams.workspaceId })
      .from(facetEventBindings).innerJoin(facetStreams, eq(facetStreams.id, facetEventBindings.streamId))
      .where(eq(facetEventBindings.eventId, stored.event.id));
    const resolved = stored.event === null ? stored.context !== undefined
      : binding[0]?.workspaceId === workspaceId;
    await tx.insert(facetCommandContexts).values({
      ownerId: accountId, commandKey: receiptRow.commandKey,
      workspaceId, status: resolved ? "resolved" : "pending",
      commandDigest: resolved ? receiptRow.commandDigest : null,
    }).onConflictDoNothing();
  }
}

/** A chain is qualified only when it is single-headed, reciprocal, acyclic. */
export function qualifyChain(events: ChainEvent[]): { qualified: boolean; cause: string | null } {
  if (events.length === 0) return { qualified: false, cause: "empty-chain" };
  const byId = new Map(events.map((event) => [event.id, event]));
  const heads = events.filter((event) => event.supersededBy === null);
  if (heads.length !== 1) return { qualified: false, cause: "multiple-heads" };
  const seen = new Set<string>();
  let current: ChainEvent | null | undefined = heads[0];
  while (current) {
    if (seen.has(current.id)) return { qualified: false, cause: "cycle" };
    seen.add(current.id);
    if (current.supersedes === null) break;
    const parent = byId.get(current.supersedes);
    if (!parent) return { qualified: false, cause: "cross-target-link" };
    if (parent.supersededBy !== current.id) return { qualified: false, cause: "non-reciprocal-link" };
    current = parent;
  }
  if (seen.size !== events.length) return { qualified: false, cause: "orphan-events" };
  const first = events[0]!;
  const sameStream = events.every((event) => event.ownerId === first.ownerId
    && event.citySlug === first.citySlug && event.nodeType === first.nodeType
    && event.nodeId === first.nodeId && event.facet === first.facet
    && (event.basket ?? null) === (first.basket ?? null));
  if (!sameStream) return { qualified: false, cause: "cross-stream-linkage" };
  return { qualified: true, cause: null };
}
