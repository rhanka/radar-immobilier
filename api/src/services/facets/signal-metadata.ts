import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { SIGNAL_METADATA_CLASSES, signalMetadataCounts, mergeVivierFiltreCubes,
  type SignalMetadataFilter, type SignalMetadataResponse, type VivierFiltreCubesByClassement } from "@radar/domain";
import type { Database } from "../../db/client.js";
import { facetEvents, facetEventBindings } from "../../db/schema.js";
import { approvedAccountId, resolveWorkspaceAccess } from "../workspaces/store.js";
import { lockWorkspace } from "../workspaces/mutations.js";
import { requireScopedEpochFor } from "./activation.js";
import { ScopeError } from "./scope.js";
import { SIGNAL_METADATA_VERSION } from "./signal-metadata-projection.js";

/** No graph payload column participates in this query, including its date predicate. */
export function metadataCellsSql(accountId: string, workspaceId: string, filter: SignalMetadataFilter) {
  const dates = filter.dateBasis === "scrap" ? sql`m.scrap_dates` : sql`m.document_dates`;
  const window = !filter.dateFrom && !filter.dateTo ? sql`true` : sql`EXISTS
    (SELECT 1 FROM unnest(${dates}) d WHERE (${filter.dateFrom ?? null}::text IS NULL OR d>=${filter.dateFrom ?? null})
      AND (${filter.dateTo ?? null}::text IS NULL OR d<=${filter.dateTo ?? null}))`;
  return sql`WITH heads AS MATERIALIZED (
    SELECT s.city_slug,s.node_type,s.node_id,
      bool_or(s.facet='archive') AS archived,
      bool_or(s.facet='selection' AND s.basket='pertinent') AS pertinent,
      bool_or(s.facet='selection' AND s.basket='a_surveiller') AS surveiller
    FROM facet_streams s JOIN facet_heads h ON h.stream_id=s.id JOIN facet_events e ON e.id=h.event_id
    WHERE s.workspace_id=${workspaceId} AND s.target_type='signal' AND e.state='active'
      AND ((s.scope='workspace' AND s.facet='archive') OR (s.scope='personal' AND s.owner_id=${accountId}))
    GROUP BY s.city_slug,s.node_type,s.node_id
  ), manual AS MATERIALIZED (
    SELECT DISTINCT city_slug,node_type,node_id FROM facet_events WHERE target_type='signal' AND source='manual'
  ), classified AS (
    SELECT m.city_slug,m.filter_bits,
      CASE WHEN h.archived THEN 'ecarte' WHEN h.pertinent THEN 'pertinent' WHEN h.surveiller THEN 'a_surveiller'
        WHEN f.node_id IS NULL THEN coalesce(a.classe,'non_classe') ELSE 'non_classe' END AS classe
    FROM signal_metadata m
    LEFT JOIN heads h USING(city_slug,node_type,node_id)
    LEFT JOIN manual f USING(city_slug,node_type,node_id)
    LEFT JOIN signal_class_annotations a ON a.city_slug=m.city_slug AND a.node_type=m.node_type
      AND a.node_id=m.node_id AND a.source='ai'
    WHERE m.version=${SIGNAL_METADATA_VERSION} AND m.filter_bits IS NOT NULL AND ${window}
  ) SELECT city_slug,filter_bits,classe,count(*)::integer AS count
    FROM classified GROUP BY city_slug,filter_bits,classe ORDER BY city_slug,classe,filter_bits`;
}

export async function readSignalMetadata(db: Database, sub: string, workspaceId: string,
  filter: SignalMetadataFilter): Promise<SignalMetadataResponse> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
    await lockWorkspace(tx, workspaceId);
    const accountId = await approvedAccountId(tx, sub, true);
    await resolveWorkspaceAccess(tx, workspaceId, sub);
    await requireScopedEpochFor(tx, workspaceId);
    const unresolved = await tx.select({ id: facetEvents.id }).from(facetEvents)
      .leftJoin(facetEventBindings, eq(facetEventBindings.eventId, facetEvents.id))
      .where(and(eq(facetEvents.ownerId, accountId), isNull(facetEventBindings.eventId))).limit(1);
    if (unresolved.length) throw new ScopeError(503, "personal_history_unresolved");
    // Missing/stale backfills are explicit failures. Never invoke the payload reader.
    const missing = await tx.execute(sql`SELECT g.city_slug FROM graph_source_revisions g
      LEFT JOIN signal_metadata_versions v USING(city_slug)
      WHERE v.version IS DISTINCT FROM ${SIGNAL_METADATA_VERSION} LIMIT 1`);
    if (missing.rows.length) throw new ScopeError(503, "signal_metadata_backfill_required");
    const cells = await tx.execute(metadataCellsSql(accountId, workspaceId, filter));
    const byCity = new Map<string, VivierFiltreCubesByClassement>();
    for (const row of cells.rows) {
      const city = String(row.city_slug);
      const cubes = byCity.get(city) ?? { pertinent: {}, a_surveiller: {}, non_classe: {}, ecarte: {} };
      cubes[row.classe as keyof typeof cubes][String(row.filter_bits)] = Number(row.count);
      byCity.set(city, cubes);
    }
    const cities = [...byCity].map(([citySlug, cubes]) =>
      ({ citySlug, ...signalMetadataCounts(cubes, filter), facetsByClass: cubes }));
    const all = Object.fromEntries(SIGNAL_METADATA_CLASSES.map((c) =>
      [c, mergeVivierFiltreCubes(cities.map((city) => city.facetsByClass[c]))])) as VivierFiltreCubesByClassement;
    // The transaction snapshot includes class history across readers/workspaces.
    const revision = await tx.execute(sql`SELECT pg_current_snapshot()::text AS snapshot`);
    const snapshot = createHash("sha256").update(JSON.stringify([
      "metadata-v2", SIGNAL_METADATA_VERSION, accountId, workspaceId, revision.rows[0]?.snapshot,
    ])).digest("hex");
    const { matched, classCounts, facetCounts } = signalMetadataCounts(all, filter);
    return { contract: "metadata-v2", snapshot, totalMatched: matched, classCounts, facetCounts, cities };
  });
}
