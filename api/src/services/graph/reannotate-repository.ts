import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { graphNodes } from "../../db/schema.js";
import { readClassAnnotations, writeClassAnnotation, type ClassAnnotation } from "./class-annotations.js";
import type { ReannotationRepository, ReannotationSignal } from "./reannotate-signals.js";
import { REANNOTATION_LIST_STATEMENT_TIMEOUT_MS, withReannotationDb } from "./reannotate-db.js";

export const DEFAULT_REANNOTATION_CITY_BATCH_SIZE = 20;
const REANNOTATION_NODE_TYPES = ["Signal", "DesignationEvent"] as const;
const REANNOTATION_NODE_COLUMNS = {
  citySlug: graphNodes.citySlug,
  id: graphNodes.id,
  type: graphNodes.type,
  label: graphNodes.label,
  props: graphNodes.props,
  sourceRef: graphNodes.sourceRef,
};

export interface ReannotationRepositoryOptions {
  cityBatchSize?: number;
  listStatementTimeoutMs?: number;
}

/** Loose index scan over graph_nodes_pkey (city_slug, id): O(cities * log N). */
async function listDistinctGraphCities(bounded: Database): Promise<string[]> {
  const result = await bounded.execute(sql`WITH RECURSIVE cities(city_slug) AS (
    (SELECT city_slug FROM graph_nodes ORDER BY city_slug ASC LIMIT 1)
    UNION ALL
    SELECT next_city.city_slug
    FROM cities c
    CROSS JOIN LATERAL (
      SELECT g.city_slug
      FROM graph_nodes g
      WHERE g.city_slug > c.city_slug
      ORDER BY g.city_slug ASC
      LIMIT 1
    ) next_city
  )
  SELECT city_slug FROM cities ORDER BY city_slug ASC`);
  return result.rows.map((row) => String((row as { city_slug: unknown }).city_slug));
}

export function createReannotationRepository(
  db: Database,
  scope?: { citySlug: string; nodeIds: readonly string[] },
  options?: ReannotationRepositoryOptions,
): ReannotationRepository {
  const cityBatchSize = options?.cityBatchSize ?? DEFAULT_REANNOTATION_CITY_BATCH_SIZE;
  if (!Number.isInteger(cityBatchSize) || cityBatchSize < 1 || cityBatchSize > 500) {
    throw new Error("Reannotation cityBatchSize must be an integer from 1 to 500");
  }
  const listStatementTimeoutMs = options?.listStatementTimeoutMs ?? REANNOTATION_LIST_STATEMENT_TIMEOUT_MS;
  const annotations = new Map<string, Map<string, ClassAnnotation>>();
  return {
    async list(since, signal) {
      if (scope) {
        if (scope.nodeIds.length === 0) return [];
        return withReannotationDb(db, signal, async (bounded) => bounded
          .select(REANNOTATION_NODE_COLUMNS)
          .from(graphNodes)
          .where(and(
            eq(graphNodes.citySlug, scope.citySlug),
            inArray(graphNodes.id, [...scope.nodeIds]),
            inArray(graphNodes.type, [...REANNOTATION_NODE_TYPES]),
          ))
          .orderBy(asc(graphNodes.citySlug), asc(graphNodes.id)));
      }
      const cities = await withReannotationDb(db, signal, listDistinctGraphCities,
        { statementTimeoutMs: listStatementTimeoutMs });
      if (cities.length === 0) return [];
      const results: ReannotationSignal[] = [];
      for (let i = 0; i < cities.length; i += cityBatchSize) {
        signal?.throwIfAborted();
        const cityBatch = cities.slice(i, i + cityBatchSize);
        const batchRows = await withReannotationDb(db, signal, async (bounded) => bounded
          .select(REANNOTATION_NODE_COLUMNS)
          .from(graphNodes)
          .where(and(
            inArray(graphNodes.citySlug, cityBatch),
            gte(graphNodes.createdAt, since),
            inArray(graphNodes.type, [...REANNOTATION_NODE_TYPES]),
          ))
          .orderBy(asc(graphNodes.citySlug), asc(graphNodes.id)),
        { statementTimeoutMs: listStatementTimeoutMs });
        results.push(...batchRows);
      }
      return results;
    },
    async annotation(signal, abort) {
      const manual = await withReannotationDb(db, abort, (bounded) => bounded.execute(sql`SELECT 1
        FROM facet_events WHERE target_type='signal' AND source='manual' AND city_slug=${signal.citySlug}
        AND node_type=${signal.type} AND node_id=${signal.id} LIMIT 1`));
      if (manual.rows.length) return { source: "manual" };
      let city = annotations.get(signal.citySlug);
      if (!city) {
        city = await withReannotationDb(db, abort, (bounded) => readClassAnnotations(bounded, signal.citySlug));
        annotations.set(signal.citySlug, city);
      }
      return city.get(`${signal.type}:${signal.id}`);
    },
    write: (input, signal) => withReannotationDb(db, signal, (bounded) => writeClassAnnotation(bounded, input)),
  };
}
