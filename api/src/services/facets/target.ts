import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { graphNodes } from "../../db/schema.js";

export interface SignalTarget {
  citySlug: string;
  type: "Signal" | "DesignationEvent";
  id: string;
}
export class FacetError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 422, message: string) {
    super(message);
  }
}
/** JSON canonicalization sorts object keys recursively, preserving array order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(row[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
export function targetFingerprint(node: Pick<typeof graphNodes.$inferSelect, "type" | "label" | "sourceRef" | "props">): string {
  const props = { ...(node.props as Record<string, unknown>) };
  delete props.community;
  delete props.community_name;
  return digest({ type: node.type, label: node.label, source_ref: node.sourceRef, props });
}
export async function resolveTarget(db: Pick<Database, "select">, target: SignalTarget) {
  const [node] = await db.select().from(graphNodes).where(and(
    eq(graphNodes.citySlug, target.citySlug), eq(graphNodes.type, target.type), eq(graphNodes.id, target.id),
  ));
  if (!node) throw new FacetError(404, "signal_not_found");
  return targetFingerprint(node);
}
