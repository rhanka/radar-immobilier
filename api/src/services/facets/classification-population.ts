import type { Database } from "../../db/client.js";
import { getSignalNodesForCity } from "../graph/graph-store.js";
import { NativeTarget } from "./classification-query.js";
import { ClassificationError } from "./classification-errors.js";
import type { SignalTarget } from "./target.js";

export const POPULATION = "signal_nodes_v1" as const;
export type ClassificationNode = Awaited<ReturnType<typeof getSignalNodesForCity>>[number];
export function nativeKey(target: SignalTarget): string {
  return JSON.stringify([target.citySlug, target.type, target.id]);
}
export function nodeTarget(node: ClassificationNode): SignalTarget {
  const parsed = NativeTarget.safeParse({ citySlug: node.citySlug, type: node.type, id: node.id });
  if (!parsed.success) throw new ClassificationError("upstream_bad_payload");
  return parsed.data;
}
export async function readSignalPopulation(db: Database, citySlug: string) {
  const rows = await getSignalNodesForCity(db, citySlug);
  const keys = new Set<string>();
  for (const row of rows) {
    const target = nodeTarget(row);
    const key = nativeKey(target);
    if (target.citySlug !== citySlug || keys.has(key)) throw new ClassificationError("upstream_bad_payload");
    keys.add(key);
  }
  return rows;
}
