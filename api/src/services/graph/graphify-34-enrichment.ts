import {
  deriveEtape,
  type GraphifyGraph,
  type GraphifyNode,
} from "./graph-store.js";
import { instrumentFromSignal } from "./vivier-v2.js";

export const GRAPHIFY34_PASS = "3.4" as const;
export const GRAPHIFY34_ONTOLOGY_VERSION = "2.3" as const;

const SIGNAL_NODE_TYPES = new Set(["Signal", "DesignationEvent"]);

export interface Graphify34Snapshot extends GraphifyGraph {
  municipality: string;
  ontology_version: typeof GRAPHIFY34_ONTOLOGY_VERSION;
  graphify_pass: typeof GRAPHIFY34_PASS;
}

export interface Graphify34FieldStats {
  before_missing: number;
  after_present: number;
  added_or_canonicalized: number;
}

export interface Graphify34EnrichmentStats {
  node_count: number;
  signal_node_count: number;
  fields: {
    effet_densifiant: Graphify34FieldStats;
    etape: Graphify34FieldStats;
    instrument: Graphify34FieldStats;
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function present(properties: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(properties, key) &&
    properties[key] !== null &&
    properties[key] !== undefined &&
    properties[key] !== "";
}

function sortedRecord(properties: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function emptyFieldStats(): Graphify34FieldStats {
  return { before_missing: 0, after_present: 0, added_or_canonicalized: 0 };
}

function graphNodeProperties(node: GraphifyNode): Record<string, unknown> {
  return record(node.properties);
}

function enrichNode(
  node: GraphifyNode,
  fields: Graphify34EnrichmentStats["fields"],
): GraphifyNode {
  if (!SIGNAL_NODE_TYPES.has(node.type ?? node.file_type ?? "")) return node;

  const properties = graphNodeProperties(node);
  const nextProperties = { ...properties };
  const label = node.label ?? null;
  const description = node.description ?? stringValue(properties.description);
  const category = stringValue(properties.category);

  if (!present(properties, "effet_densifiant")) fields.effet_densifiant.before_missing++;
  // Do not install an `inconnu` placeholder: Vivier already defaults an
  // absent value to `inconnu`, while a present placeholder would block the
  // guarded Geo writer that will supply the real density effect.
  if (present(nextProperties, "effet_densifiant")) fields.effet_densifiant.after_present++;

  if (!present(properties, "etape")) {
    fields.etape.before_missing++;
    nextProperties.etape = deriveEtape(label, description);
    fields.etape.added_or_canonicalized++;
  }
  if (present(nextProperties, "etape")) fields.etape.after_present++;

  const instrument = instrumentFromSignal(
    category,
    label,
    description,
    stringValue(properties.instrument),
  );
  if (!present(properties, "instrument")) {
    fields.instrument.before_missing++;
    nextProperties.instrument = instrument;
    fields.instrument.added_or_canonicalized++;
  }
  if (present(nextProperties, "instrument")) fields.instrument.after_present++;

  return { ...node, properties: sortedRecord(nextProperties) };
}

/**
 * Deterministically enrich an existing graph snapshot. This function never
 * reads raw documents and never derives a density effect. A missing density
 * effect remains missing until its dedicated Geo artifact supplies the value.
 */
export function enrichGraphify34Snapshot(
  graph: GraphifyGraph,
  municipality: string,
): { snapshot: Graphify34Snapshot; stats: Graphify34EnrichmentStats } {
  const fields = {
    effet_densifiant: emptyFieldStats(),
    etape: emptyFieldStats(),
    instrument: emptyFieldStats(),
  };
  const signalNodeCount = graph.nodes.filter((node) =>
    SIGNAL_NODE_TYPES.has(node.type ?? node.file_type ?? ""),
  ).length;
  const nodes = graph.nodes
    .map((node) => enrichNode(node, fields))
    .sort((left, right) => left.id.localeCompare(right.id));
  const snapshot: Graphify34Snapshot = {
    nodes,
    ...(graph.links !== undefined ? { links: graph.links } : {}),
    ...(graph.edges !== undefined ? { edges: graph.edges } : {}),
    municipality,
    ontology_version: GRAPHIFY34_ONTOLOGY_VERSION,
    graphify_pass: GRAPHIFY34_PASS,
  };
  return {
    snapshot,
    stats: { node_count: nodes.length, signal_node_count: signalNodeCount, fields },
  };
}
