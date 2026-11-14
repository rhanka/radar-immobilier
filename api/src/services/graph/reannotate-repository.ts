import { and, asc, gte, inArray } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { graphNodes } from "../../db/schema.js";
import { readClassAnnotations, writeClassAnnotation, type ClassAnnotation } from "./class-annotations.js";
import type { ReannotationRepository } from "./reannotate-signals.js";

export function createReannotationRepository(db: Database): ReannotationRepository {
  const annotations = new Map<string, Map<string, ClassAnnotation>>();
  return {
    list: (since) => db.select({ citySlug: graphNodes.citySlug, id: graphNodes.id,
      type: graphNodes.type, label: graphNodes.label, props: graphNodes.props,
      sourceRef: graphNodes.sourceRef }).from(graphNodes)
      .where(and(gte(graphNodes.createdAt, since), inArray(graphNodes.type, ["Signal", "DesignationEvent"])))
      .orderBy(asc(graphNodes.citySlug), asc(graphNodes.id)),
    async annotation(signal) {
      let city = annotations.get(signal.citySlug);
      if (!city) { city = await readClassAnnotations(db, signal.citySlug); annotations.set(signal.citySlug, city); }
      return city.get(`${signal.type}:${signal.id}`);
    },
    write: (input) => writeClassAnnotation(db, input),
  };
}
