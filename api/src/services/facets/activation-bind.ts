import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { facetEventBindings, facetEvents, facetHeads, facetStreams } from "../../db/schema.js";
import { assertStreamIdentity, ScopeError, streamKey } from "./scope.js";
import { qualifyChain, sealPendingReceiptContexts, type ActivationReceipt } from "./activation.js";
import { streamIdentityFor } from "./scoped-reader.js";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function bindAttachedChains(tx: Tx, workspaceId: string, accounts: Array<{ accountId: string }>) {
  let streamsBound = 0;
  const sealedUnresolved: ActivationReceipt["sealedUnresolved"] = [];
  for (const attachment of accounts) {
    const rows = await tx.select({ event: facetEvents }).from(facetEvents)
      .leftJoin(facetEventBindings, eq(facetEventBindings.eventId, facetEvents.id))
      .where(and(eq(facetEvents.ownerId, attachment.accountId),
        eq(facetEvents.scope, "personal"), isNull(facetEventBindings.eventId)));
    const events = rows.map(({ event }) => {
      if (event.ownerId === null) throw new ScopeError(503, "personal_history_unresolved");
      return { ...event, ownerId: event.ownerId };
    });
    const groups = new Map<string, typeof events>();
    for (const event of events) {
      const identity = streamIdentityFor(workspaceId, attachment.accountId, {
        citySlug: event.citySlug, nodeType: event.nodeType as "Signal" | "DesignationEvent",
        nodeId: event.nodeId, facet: event.facet as "selection" | "archive",
        basket: event.basket as "pertinent" | "a_surveiller" | null,
      });
      assertStreamIdentity(identity);
      const key = streamKey(identity);
      groups.set(key, [...(groups.get(key) ?? []), event]);
    }
    for (const chain of [...groups.values()].sort((a, b) => a[0]!.id.localeCompare(b[0]!.id))) {
      const ids = new Set(chain.map((event) => event.id));
      const externalLink = events.some((event) => !ids.has(event.id)
        && ((event.supersedes !== null && ids.has(event.supersedes))
          || (event.supersededBy !== null && ids.has(event.supersededBy))));
      const { qualified, cause } = externalLink
        ? { qualified: false, cause: "cross-stream-linkage" } : qualifyChain(chain);
      if (!qualified) {
        sealedUnresolved.push({ ownerId: attachment.accountId, cause: cause ?? "unqualified" });
        continue;
      }
      const head = chain.find((event) => event.supersededBy === null)!;
      const [stream] = await tx.insert(facetStreams).values({
        workspaceId, scope: "personal", ownerId: attachment.accountId,
        targetType: "signal", citySlug: head.citySlug, nodeType: head.nodeType,
        nodeId: head.nodeId, facet: head.facet, basket: head.basket,
      }).returning();
      for (const event of [...chain].sort((a, b) => a.id.localeCompare(b.id))) {
        await tx.insert(facetEventBindings).values({ eventId: event.id, streamId: stream!.id });
      }
      await tx.insert(facetHeads).values({ streamId: stream!.id, eventId: head.id });
      streamsBound += 1;
    }
    await sealPendingReceiptContexts(tx, workspaceId, attachment.accountId);
  }
  return { streamsBound, sealedUnresolved };
}
