/**
 * Identified synthetic graph set: one graph per slug, snapshot id plus
 * canonical JSON sha256, shared reglement normalization.
 */

import { createHash } from "node:crypto";
import { SteveCaptureError } from "../types.js";

export const GRAPH_NODE_SIGNAL = "Signal";
export const GRAPH_NODE_DESIGNATION_EVENT = "DesignationEvent";

const GRAPH_NODE_TYPES = new Set([GRAPH_NODE_SIGNAL, GRAPH_NODE_DESIGNATION_EVENT]);
export function isGraphNodeType(type: string): boolean {
  return GRAPH_NODE_TYPES.has(type);
}

export interface SyntheticGraphNode {
  id: string;
  type: string;
  props: Record<string, unknown>;
}

export interface SyntheticGraph {
  slug: string;
  nodes: SyntheticGraphNode[];
}

export interface IdentifiedGraphSet {
  snapshotId: string;
  sha256: string;
  graphs: SyntheticGraph[];
}

export function normalizeReglementKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, "");
}

export interface ReglementTokens {
  kept: string[];
  ignored: number;
}

export function splitReglementTokens(raw: string | null): ReglementTokens {
  if (raw === null) return { kept: [], ignored: 0 };
  const parts = raw.split(/[,;\n\r]+/);
  const kept: string[] = [];
  let ignored = 0;
  for (const part of parts) {
    const token = part.trim();
    if (token.length === 0) continue;
    if (!/\d/.test(token)) {
      ignored += 1;
      continue;
    }
    kept.push(normalizeReglementKey(token));
  }
  return { kept, ignored };
}

export function normalizeGraphReglementProp(
  value: unknown,
): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return normalizeReglementKey(String(value));
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return normalizeReglementKey(trimmed);
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) =>
    [key, canonicalValue((value as Record<string, unknown>)[key])],
  ));
}

export function canonicalGraphSetJson(
  snapshotId: string,
  graphs: readonly SyntheticGraph[],
): string {
  const ordered = [...graphs]
    .map((graph) => ({
      slug: graph.slug,
      nodes: [...graph.nodes]
        .map((node) => ({
          id: node.id,
          type: node.type,
          props: canonicalValue(node.props),
        }))
        .sort((a, b) => {
          const left = JSON.stringify(a), right = JSON.stringify(b);
          return left < right ? -1 : left > right ? 1 : 0;
        }),
    }))
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return JSON.stringify({ snapshotId, graphs: ordered });
}

export function buildGraphSet(
  snapshotId: string,
  graphs: readonly SyntheticGraph[],
): IdentifiedGraphSet {
  if (snapshotId.trim().length === 0) {
    throw new SteveCaptureError("graph set snapshot id is empty");
  }
  const seen = new Set<string>();
  for (const graph of graphs) {
    if (graph.slug.trim().length === 0) {
      throw new SteveCaptureError("graph set contains an empty slug");
    }
    if (seen.has(graph.slug)) {
      throw new SteveCaptureError(
        `duplicate graph slug "${graph.slug}" in graph set`,
      );
    }
    seen.add(graph.slug);
  }
  const sha256 = createHash("sha256")
    .update(canonicalGraphSetJson(snapshotId, graphs))
    .digest("hex");
  const ordered = [...graphs]
    .map((graph) => ({
      slug: graph.slug,
      nodes: graph.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        props: { ...node.props },
      })),
    }))
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return { snapshotId, sha256, graphs: ordered };
}

export function findGraph(
  graphSet: IdentifiedGraphSet,
  slug: string,
): SyntheticGraph | null {
  const found = graphSet.graphs.find((graph) => graph.slug === slug);
  return found ?? null;
}
