import type { facetEvents } from "../../db/schema.js";

type ResponseSource = Pick<typeof facetEvents.$inferSelect,
  "id" | "citySlug" | "nodeType" | "nodeId" | "facet" | "basket" | "state" | "reasonCode" | "verdict"
> & { createdAt: Date | string };

/** Explicit public fields shared by command snapshots and current heads. */
export function facetEventResponse(event: ResponseSource) {
  return {
    id: event.id,
    target: { citySlug: event.citySlug, type: event.nodeType, id: event.nodeId },
    facet: event.facet,
    basket: event.basket,
    state: event.state,
    reasonCode: event.reasonCode,
    verdict: event.verdict,
    createdAt: typeof event.createdAt === "string" ? event.createdAt : event.createdAt.toISOString(),
  };
}
