import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { facetEvents, facetReasonCodes, graphNodes } from "../../db/schema.js";
import { FACET_PROFILE } from "./codebook.js";
import { targetFingerprint } from "./target.js";
import { approvedOwner } from "./writer.js";
import { facetEventResponse } from "./response.js";

export async function readReasonCodes(db: Database, sub: string) {
  await approvedOwner(db, sub);
  return db.select({ code: facetReasonCodes.code, verdict: facetReasonCodes.verdict })
    .from(facetReasonCodes).where(eq(facetReasonCodes.profileId, FACET_PROFILE))
    .orderBy(facetReasonCodes.verdict, facetReasonCodes.code);
}
export async function readCityFacets(db: Database, sub: string, city: string) {
  const ownerId = await approvedOwner(db, sub);
  const rows = await db.select({ event: facetEvents, node: graphNodes }).from(facetEvents)
    .leftJoin(graphNodes, and(eq(graphNodes.citySlug, facetEvents.citySlug),
      eq(graphNodes.type, facetEvents.nodeType), eq(graphNodes.id, facetEvents.nodeId)))
    .where(and(eq(facetEvents.scope, "personal"), eq(facetEvents.ownerId, ownerId),
      eq(facetEvents.citySlug, city), isNull(facetEvents.supersededBy)))
    .orderBy(facetEvents.nodeType, facetEvents.nodeId, facetEvents.facet, facetEvents.basket);
  return rows.map(({ event, node }) => ({
    ...facetEventResponse(event),
    targetAvailable: node !== null,
    changedSinceArchive: event.facet === "archive" && event.state === "active" && node !== null
      ? event.observedFingerprint !== targetFingerprint(node) : null,
  }));
}
