import { and, asc, eq, gte, inArray } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { graphNodes } from "../../db/schema.js";
import { readClassAnnotations, writeClassAnnotation, type ClassAnnotation } from "./class-annotations.js";
import type { ReannotationRepository } from "./reannotate-signals.js";
import { withReannotationDb } from "./reannotate-db.js";

export function createReannotationRepository(db: Database,
  scope?: { citySlug: string; nodeIds: readonly string[] }): ReannotationRepository {
  const annotations = new Map<string, Map<string, ClassAnnotation>>();
  return {
    list: (since, signal) => withReannotationDb(db, signal, async (bounded) => bounded.select({ citySlug: graphNodes.citySlug, id: graphNodes.id,
      type: graphNodes.type, label: graphNodes.label, props: graphNodes.props,
      sourceRef: graphNodes.sourceRef }).from(graphNodes)
      .where(and(scope ? and(eq(graphNodes.citySlug, scope.citySlug), inArray(graphNodes.id, [...scope.nodeIds]))
        : gte(graphNodes.createdAt, since), inArray(graphNodes.type, ["Signal", "DesignationEvent"])))
      .orderBy(asc(graphNodes.citySlug), asc(graphNodes.id))),
    async annotation(signal, abort) {
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
