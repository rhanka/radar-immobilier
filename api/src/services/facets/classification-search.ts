import type { Database } from "../../db/client.js";
import type { ObjectStore } from "../../storage/object-store.js";
import { createDocEnrichmentContext } from "../../routes/graph-signals.js";
import { readProjectionScope } from "./projection-revisions.js";
import { SignalQuery, type SignalQueryArgs } from "./classification-query.js";
import { readSignalPopulation, nodeTarget, POPULATION } from "./classification-population.js";
import { readClassificationHeads, projectFacets } from "./classification-heads.js";
import { selectClassifications } from "./classification-counts.js";
import { classificationDay, compareSignalRows } from "./classification-order.js";
import { classificationQueryDigest, readClassificationProjection } from "./classification-projection.js";
import { requireCursorKeyring, type CursorKeyring } from "./classification-cursor.js";
import { continueSignalSearch, validateSignalContinuation } from "./classification-continuation.js";
import { projectClassificationItem } from "./classification-item.js";
import { SignalSearchResponse } from "./classification-search-contract.js";
import { ClassificationError } from "./classification-errors.js";

export interface ClassificationOptions { cursorKeyring?: CursorKeyring; apiOrigin?: string; now?: () => number }
export interface ClassificationReadDeps { db: Database; store: ObjectStore; classification?: ClassificationOptions }
export const PAYLOAD_MAX_BYTES = 2_097_152;
export function boundedClassificationJson(value: unknown, limit?: number): string {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) > PAYLOAD_MAX_BYTES) throw new ClassificationError("projection_payload_too_large",
    limit && limit > 1 ? Math.max(1, Math.floor(limit / 2)) : undefined);
  return json;
}
export async function searchSignalClassifications(deps: ClassificationReadDeps, sub: string, workspaceId: string, input: SignalQueryArgs) {
  const query = SignalQuery.parse(input);
  // Current BASE authority precedes cursor inspection, even when signing is closed.
  await readProjectionScope(deps.db, sub, workspaceId, query.citySlug, "signal");
  const ring = requireCursorKeyring(deps.classification?.cursorKeyring);
  const filters = { citySlug: query.citySlug, basket: query.basket, archive: query.archive,
    personalHistory: query.personalHistory, dateBasis: query.dateBasis, sort: query.sort };
  const enrichment = createDocEnrichmentContext(2000);
  const now = () => deps.classification?.now?.() ?? Math.floor(Date.now() / 1000);
  const result = await readClassificationProjection(deps.db, sub, workspaceId, query.citySlug, filters, async (catalog) => {
    const previous = validateSignalContinuation(ring, { sub, workspaceId, citySlug: query.citySlug,
      queryDigest: classificationQueryDigest(filters, catalog) }, query.limit, query.cursor, now());
    const position = previous?.position ?? 0;
    const nodes = await readSignalPopulation(deps.db, query.citySlug);
    const heads = await readClassificationHeads(deps.db, sub, workspaceId, query.citySlug);
    const rows = nodes.map((node) => ({ node, target: nodeTarget(node), day: classificationDay(node.props),
      facets: projectFacets(heads, nodeTarget(node)) }));
    const selected = selectClassifications(rows, query);
    selected.matched.sort(compareSignalRows);
    const items = await Promise.all(selected.matched.slice(position, position + query.limit).map((row) =>
      projectClassificationItem(deps.store, row, enrichment, deps.classification?.apiOrigin)));
    return { ...selected, items };
  });
  const page = continueSignalSearch(result.payload.matched, ring, { sub, workspaceId, citySlug: query.citySlug,
    queryDigest: result.snapshot.queryDigest, snapshotToken: result.snapshot.queryToken }, query.limit, query.cursor,
  now()).page;
  const response = SignalSearchResponse.parse({ ok: true, contractVersion: "signal-classifications-v1", workspaceId,
    citySlug: query.citySlug, mode: "signal", population: POPULATION, snapshot: result.snapshot,
    counts: result.payload.counts, items: result.payload.items, page });
  boundedClassificationJson(response, query.limit);
  return response;
}
