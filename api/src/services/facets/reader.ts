import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { facetEvents, facetReasonCodes, graphNodes } from "../../db/schema.js";
import { FACET_PROFILE } from "./codebook.js";
import { targetFingerprint } from "./target.js";
import { approvedOwner } from "./writer.js";

export async function readReasonCodes(db: Database, sub: string) {
  return db.transaction(async (tx) => {
    await approvedOwner(tx, sub);
    return tx.select({ code: facetReasonCodes.code, verdict: facetReasonCodes.verdict })
      .from(facetReasonCodes).where(eq(facetReasonCodes.profileId, FACET_PROFILE))
      .orderBy(facetReasonCodes.verdict, facetReasonCodes.code);
  });
}
export async function readCityFacets(db: Database, sub: string, city: string) {
  return db.transaction(async (tx) => {
    const ownerId = await approvedOwner(tx, sub);
    const rows = await tx.select({ event: facetEvents, node: graphNodes }).from(facetEvents)
      .leftJoin(graphNodes, and(eq(graphNodes.citySlug, facetEvents.citySlug),
        eq(graphNodes.type, facetEvents.nodeType), eq(graphNodes.id, facetEvents.nodeId)))
      .where(and(eq(facetEvents.scope, "personal"), eq(facetEvents.ownerId, ownerId),
        eq(facetEvents.citySlug, city), isNull(facetEvents.supersededBy)))
      .orderBy(facetEvents.nodeType, facetEvents.nodeId, facetEvents.facet, facetEvents.basket);
    return rows.map(({ event, node }) => ({
      ...event,
      targetAvailable: node !== null,
      changedSinceArchive: event.facet === "archive" && event.state === "active" && node !== null
        ? event.observedFingerprint !== targetFingerprint(node) : null,
    }));
  });
}
