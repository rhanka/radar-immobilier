import { and, asc, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
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

function createAnnotationReader(db: Database): ReannotationRepository["annotation"] {
  const annotations = new Map<string, Map<string, ClassAnnotation>>();
  return async (signal: ReannotationSignal, abort?: AbortSignal) => {
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
  };
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
    annotation: createAnnotationReader(db),
    write: (input, signal) => withReannotationDb(db, signal, (bounded) => writeClassAnnotation(bounded, input)),
  };
}

export interface UnclassifiedCityScope {
  readonly citySlug: string;
  readonly windowFrom: string;
  readonly limit: number;
  readonly excludeNodeIds?: readonly string[];
}

/**
 * Signals and DesignationEvents of one city in the current documentary-date window
 * that lack both a manual class and a valid AI class, ordered newest first and capped.
 */
export function createUnclassifiedCityRepository(db: Database,
  scope: UnclassifiedCityScope): ReannotationRepository {
  return {
    list: async (_since, signal) => {
      if (scope.limit <= 0) return [];
      const excluded = scope.excludeNodeIds?.length
        ? notInArray(graphNodes.id, [...scope.excludeNodeIds])
        : undefined;
      return withReannotationDb(db, signal, async (bounded) => bounded
        .select(REANNOTATION_NODE_COLUMNS)
        .from(graphNodes)
        .where(and(
          eq(graphNodes.citySlug, scope.citySlug),
          inArray(graphNodes.type, [...REANNOTATION_NODE_TYPES]),
          sql`EXISTS (SELECT 1 FROM unnest(${graphNodes.effectiveDocumentDates}) AS d WHERE d >= ${scope.windowFrom})`,
          sql`NOT EXISTS (
            SELECT 1 FROM signal_class_annotations a
            WHERE a.city_slug = ${graphNodes.citySlug}
              AND a.node_type = ${graphNodes.type}
              AND a.node_id = ${graphNodes.id}
              AND (a.source = 'manual' OR a.classe IN ('pertinent', 'a_surveiller', 'ecarte'))
          )`,
          sql`NOT EXISTS (
            SELECT 1 FROM facet_events f
            WHERE f.target_type = 'signal'
              AND f.source = 'manual'
              AND f.city_slug = ${graphNodes.citySlug}
              AND f.node_type = ${graphNodes.type}
              AND f.node_id = ${graphNodes.id}
          )`,
          ...(excluded ? [excluded] : []),
        ))
        .orderBy(
          sql`(SELECT max(d) FROM unnest(${graphNodes.effectiveDocumentDates}) AS d) DESC NULLS LAST`,
          asc(graphNodes.id),
        )
        .limit(scope.limit));
    },
    annotation: createAnnotationReader(db),
    write: (input, signal) => withReannotationDb(db, signal,
      (bounded) => writeClassAnnotation(bounded, input, { preserveExistingAi: true })),
  };
}
