import { and, asc, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { graphNodes } from "../../db/schema.js";
import { readClassAnnotations, writeClassAnnotation, type ClassAnnotation } from "./class-annotations.js";
import type { ReannotationRepository, ReannotationSignal } from "./reannotate-signals.js";
import { withReannotationDb } from "./reannotate-db.js";

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

export function createReannotationRepository(db: Database,
  scope?: { citySlug: string; nodeIds: readonly string[] }): ReannotationRepository {
  return {
    list: (since, signal) => withReannotationDb(db, signal, async (bounded) => bounded.select({ citySlug: graphNodes.citySlug, id: graphNodes.id,
      type: graphNodes.type, label: graphNodes.label, props: graphNodes.props,
      sourceRef: graphNodes.sourceRef }).from(graphNodes)
      .where(and(scope ? and(eq(graphNodes.citySlug, scope.citySlug), inArray(graphNodes.id, [...scope.nodeIds]))
        : gte(graphNodes.createdAt, since), inArray(graphNodes.type, ["Signal", "DesignationEvent"])))
      .orderBy(asc(graphNodes.citySlug), asc(graphNodes.id))),
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
      return withReannotationDb(db, signal, async (bounded) => bounded.select({
        citySlug: graphNodes.citySlug,
        id: graphNodes.id,
        type: graphNodes.type,
        label: graphNodes.label,
        props: graphNodes.props,
        sourceRef: graphNodes.sourceRef,
      }).from(graphNodes)
        .where(and(
          eq(graphNodes.citySlug, scope.citySlug),
          inArray(graphNodes.type, ["Signal", "DesignationEvent"]),
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
