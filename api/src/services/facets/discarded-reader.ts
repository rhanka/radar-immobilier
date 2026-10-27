import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { facetEvents } from "../../db/schema.js";
import {
  discardedSignalKey, EMPTY_DISCARDED_KEYS, type DiscardedSignalsPort,
} from "../graph/discarded-signals.js";
import { approvedOwner } from "./writer.js";

export function createDiscardedSignalsReader(db: Database): DiscardedSignalsPort {
  return {
    async forViewer(sub) {
      if (sub === null) return EMPTY_DISCARDED_KEYS;
      const ownerId = await approvedOwner(db, sub);
      const rows = await db.select({ citySlug: facetEvents.citySlug, nodeType: facetEvents.nodeType,
        nodeId: facetEvents.nodeId }).from(facetEvents).where(and(
        eq(facetEvents.scope, "personal"), eq(facetEvents.ownerId, ownerId),
        eq(facetEvents.facet, "archive"), eq(facetEvents.state, "active"),
        isNull(facetEvents.supersededBy),
      ));
      return new Set(rows.map((row) => discardedSignalKey(row.citySlug, row.nodeType, row.nodeId)));
    },
  };
}
