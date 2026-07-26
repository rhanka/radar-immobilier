import {
  type GraphifyGraph,
  type GraphifyLink,
  type GraphifyNode,
  type Subgraph,
} from "./graph-store.js";
import {
  GRAPHIFY34_ONTOLOGY_VERSION,
  GRAPHIFY34_PASS,
  type Graphify34Snapshot,
} from "./graphify-34-enrichment.js";

export interface Graphify34Manifest {
  municipality: string;
  graphify_pass: typeof GRAPHIFY34_PASS;
  ontology_version: typeof GRAPHIFY34_ONTOLOGY_VERSION;
  snapshot_key: string;
  snapshot_mode: "complete-city";
  source: "graph_nodes";
  node_count: number;
  edge_count: number;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function sortedRecord(properties: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function nodeFromDb(row: Subgraph["nodes"][number]): GraphifyNode {
  const stored = record(row.props);
  const properties = record(stored.properties);
  return {
    id: row.id,
    type: row.type,
    label: row.label,
    ...(row.sourceRef !== null ? { source_file: row.sourceRef } : {}),
    ...(stored.community !== undefined ? { community: Number(stored.community) } : {}),
    ...(stringValue(stored.community_name) !== null
      ? { community_name: stringValue(stored.community_name)! }
      : {}),
    ...(stringValue(stored.status) !== null ? { status: stringValue(stored.status)! } : {}),
    ...(stringValue(stored.description) !== null
      ? { description: stringValue(stored.description)! }
      : {}),
    ...(Array.isArray(stored.refs) ? { refs: stored.refs as GraphifyNode["refs"] } : {}),
    properties: sortedRecord(properties),
  };
}

function edgeFromDb(row: Subgraph["edges"][number]): GraphifyLink {
  const stored = record(row.props);
  return {
    source: row.srcId,
    target: row.dstId,
    type: row.kind,
    ...(typeof stored.confidence === "string" ? { confidence: stored.confidence } : {}),
    ...(typeof stored.confidence_score === "number"
      ? { confidence_score: stored.confidence_score }
      : {}),
    ...(typeof stored.source_file === "string" ? { source_file: stored.source_file } : {}),
    ...(Array.isArray(stored.refs) ? { refs: stored.refs as GraphifyLink["refs"] } : {}),
    properties: sortedRecord(record(stored.properties)),
  };
}

/** Build the complete city snapshot from the existing graph projection. */
export function snapshotFromExistingCity(subgraph: Subgraph): GraphifyGraph {
  return {
    nodes: subgraph.nodes.map(nodeFromDb).sort((left, right) => left.id.localeCompare(right.id)),
    edges: subgraph.edges
      .map(edgeFromDb)
      .sort((left, right) => {
        const leftKey = `${left.source}\u0000${left.target}\u0000${left.type ?? left.relation ?? ""}`;
        const rightKey = `${right.source}\u0000${right.target}\u0000${right.type ?? right.relation ?? ""}`;
        return leftKey.localeCompare(rightKey);
      }),
  };
}

export function buildGraphify34Manifest(
  municipality: string,
  snapshot: Graphify34Snapshot,
): Graphify34Manifest {
  return {
    municipality,
    graphify_pass: GRAPHIFY34_PASS,
    ontology_version: GRAPHIFY34_ONTOLOGY_VERSION,
    snapshot_key: `graph/${municipality}/latest.json`,
    snapshot_mode: "complete-city",
    source: "graph_nodes",
    node_count: snapshot.nodes.length,
    edge_count: (snapshot.edges ?? []).length + (snapshot.links ?? []).length,
  };
}
