/**
 * WP A.3.1 — Graph store service.
 *
 * Persists graphify graph.json output (nodes + links) into the Postgres
 * `graph_nodes` / `graph_edges` tables. All writes are idempotent:
 *   - nodes   → INSERT … ON CONFLICT (id) DO UPDATE SET (label, type, props)
 *   - edges   → INSERT … ON CONFLICT (src_id, dst_id, kind) DO UPDATE SET props
 *
 * Read helpers cover the two main access patterns:
 *   - `queryNeighbors(nodeId)`    → all edges incident on a node + their endpoints
 *   - `subgraphForCity(citySlug)` → all nodes + edges for a city scope
 */

import { z } from "zod";
import { eq, or, and, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { graphNodes, graphEdges } from "../../db/schema.js";

// ─────────────────────────────────────────────────────────────────────────────
// Zod schema for graphify graph.json
// ─────────────────────────────────────────────────────────────────────────────

/** A single node as emitted by graphify. */
export const graphifyNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** graphify calls this `file_type`; may be absent on older snapshots. */
  file_type: z.string().optional(),
  source_file: z.string().optional(),
  community: z.number().optional(),
  community_name: z.string().optional(),
});

/** A single link / edge as emitted by graphify. */
export const graphifyLinkSchema = z.object({
  source: z.string(),
  target: z.string(),
  /** graphify uses `relation` for the edge label. */
  relation: z.string(),
  confidence: z.string().optional(),
  confidence_score: z.number().optional(),
  source_file: z.string().optional(),
});

/**
 * The top-level graphify graph.json structure.
 *
 * graphify may emit `edges` or `links` depending on version; we accept both.
 * Extra top-level keys (graph, topology_signature, directed, multigraph) are
 * silently ignored.
 */
export const graphifyGraphSchema = z.object({
  nodes: z.array(graphifyNodeSchema),
  links: z.array(graphifyLinkSchema).optional(),
  edges: z.array(graphifyLinkSchema).optional(),
});

export type GraphifyGraph = z.infer<typeof graphifyGraphSchema>;
export type GraphifyNode = z.infer<typeof graphifyNodeSchema>;
export type GraphifyLink = z.infer<typeof graphifyLinkSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Row builders (pure — unit-testable without DB)
// ─────────────────────────────────────────────────────────────────────────────

export interface NodeRow {
  id: string;
  type: string;
  label: string;
  citySlug: string | null;
  props: Record<string, unknown>;
  sourceRef: string | null;
}

export interface EdgeRow {
  srcId: string;
  dstId: string;
  kind: string;
  props: Record<string, unknown>;
}

/** Build a DB-shaped node row from a graphify node. */
export function buildNodeRow(node: GraphifyNode, citySlug?: string | null): NodeRow {
  const { id, label, file_type, source_file, community, community_name } = node;
  return {
    id,
    label,
    type: file_type ?? "concept",
    citySlug: citySlug ?? null,
    sourceRef: source_file ?? null,
    props: {
      ...(community !== undefined ? { community } : {}),
      ...(community_name !== undefined ? { community_name } : {}),
      ...(source_file !== undefined ? { source_file } : {}),
    },
  };
}

/** Build a DB-shaped edge row from a graphify link. */
export function buildEdgeRow(link: GraphifyLink): EdgeRow {
  const { source, target, relation, confidence, confidence_score, source_file } = link;
  return {
    srcId: source,
    dstId: target,
    kind: relation,
    props: {
      ...(confidence !== undefined ? { confidence } : {}),
      ...(confidence_score !== undefined ? { confidence_score } : {}),
      ...(source_file !== undefined ? { source_file } : {}),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export interface UpsertResult {
  nodeCount: number;
  edgeCount: number;
}

/**
 * Ingest a city-scoped graphify graph.json into Postgres (idempotent).
 *
 * Nodes are upserted by their natural text `id`. Edges are upserted by the
 * (src_id, dst_id, kind) triple (unique index `graph_edges_natural_key_idx`).
 * Re-running with the same graph.json is safe and produces no duplicate rows.
 *
 * @param db       Drizzle database handle
 * @param citySlug City scope injected on every node (nullable for cross-city)
 * @param graphJson Raw parsed object (validated via graphifyGraphSchema)
 */
export async function upsertGraph(
  db: Database,
  citySlug: string | null,
  graphJson: unknown,
): Promise<UpsertResult> {
  const parsed = graphifyGraphSchema.parse(graphJson);
  const links = parsed.links ?? parsed.edges ?? [];

  const nodeRows = parsed.nodes.map((n) => buildNodeRow(n, citySlug));
  const edgeRows = links.map(buildEdgeRow);

  // Upsert nodes (ON CONFLICT on pk = id)
  if (nodeRows.length > 0) {
    await db
      .insert(graphNodes)
      .values(
        nodeRows.map((r) => ({
          id: r.id,
          type: r.type,
          label: r.label,
          citySlug: r.citySlug,
          props: r.props,
          sourceRef: r.sourceRef,
        })),
      )
      .onConflictDoUpdate({
        target: graphNodes.id,
        set: {
          label: sql`excluded.label`,
          type: sql`excluded.type`,
          props: sql`excluded.props`,
          sourceRef: sql`excluded.source_ref`,
        },
      });
  }

  // Upsert edges (ON CONFLICT on the natural-key unique index)
  if (edgeRows.length > 0) {
    await db
      .insert(graphEdges)
      .values(
        edgeRows.map((r) => ({
          srcId: r.srcId,
          dstId: r.dstId,
          kind: r.kind,
          props: r.props,
        })),
      )
      .onConflictDoUpdate({
        target: [graphEdges.srcId, graphEdges.dstId, graphEdges.kind],
        set: {
          props: sql`excluded.props`,
        },
      });
  }

  return { nodeCount: nodeRows.length, edgeCount: edgeRows.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// Read helpers
// ─────────────────────────────────────────────────────────────────────────────

export interface Neighbor {
  edge: typeof graphEdges.$inferSelect;
  node: typeof graphNodes.$inferSelect;
  direction: "out" | "in";
}

/**
 * All edges incident on `nodeId` (outgoing + incoming), with the connected
 * node record attached. Empty array when the node has no edges.
 */
export async function queryNeighbors(
  db: Database,
  nodeId: string,
): Promise<Neighbor[]> {
  // Outgoing edges
  const outEdges = await db
    .select()
    .from(graphEdges)
    .where(eq(graphEdges.srcId, nodeId));

  // Incoming edges
  const inEdges = await db
    .select()
    .from(graphEdges)
    .where(eq(graphEdges.dstId, nodeId));

  const results: Neighbor[] = [];

  for (const edge of outEdges) {
    const [node] = await db
      .select()
      .from(graphNodes)
      .where(eq(graphNodes.id, edge.dstId))
      .limit(1);
    if (node) results.push({ edge, node, direction: "out" });
  }

  for (const edge of inEdges) {
    const [node] = await db
      .select()
      .from(graphNodes)
      .where(eq(graphNodes.id, edge.srcId))
      .limit(1);
    if (node) results.push({ edge, node, direction: "in" });
  }

  return results;
}

export interface Subgraph {
  citySlug: string;
  nodes: (typeof graphNodes.$inferSelect)[];
  edges: (typeof graphEdges.$inferSelect)[];
}

/**
 * Return all nodes tagged with `citySlug` plus all edges where BOTH endpoints
 * are in that city node set.
 */
export async function subgraphForCity(
  db: Database,
  citySlug: string,
): Promise<Subgraph> {
  const nodes = await db
    .select()
    .from(graphNodes)
    .where(eq(graphNodes.citySlug, citySlug));

  if (nodes.length === 0) {
    return { citySlug, nodes: [], edges: [] };
  }

  const nodeIds = new Set(nodes.map((n) => n.id));

  // Pull all edges where src is in the city set; filter dstId in application
  // layer (avoids a large IN clause for small graphs).
  const candidateEdges = await db
    .select()
    .from(graphEdges)
    .where(
      or(
        ...Array.from(nodeIds).map((id) => eq(graphEdges.srcId, id)),
      ),
    );

  const edges = candidateEdges.filter((e) => nodeIds.has(e.dstId));

  return { citySlug, nodes, edges };
}
