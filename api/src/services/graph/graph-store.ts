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
 *   - `subgraphForMrc(mrc)`       → merged subgraph for all cities in an MRC
 *   - `listMrcs(db)`              → MRC list with ingested node counts
 */

import { z } from "zod";
import { eq, or, sql, inArray } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { graphNodes, graphEdges } from "../../db/schema.js";
import { QC_MUNICIPALITIES } from "@radar/sources";

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
 *
 * Fix N+1 : les nœuds voisins sont chargés en une seule requête `inArray`
 * plutôt qu'un SELECT par arête.
 */
export async function queryNeighbors(
  db: Database,
  nodeId: string,
): Promise<Neighbor[]> {
  // Outgoing edges (nodeId → dst)
  const outEdges = await db
    .select()
    .from(graphEdges)
    .where(eq(graphEdges.srcId, nodeId));

  // Incoming edges (src → nodeId)
  const inEdges = await db
    .select()
    .from(graphEdges)
    .where(eq(graphEdges.dstId, nodeId));

  // Collect all neighbour ids to fetch in a single round-trip.
  const neighbourIds = [
    ...outEdges.map((e) => e.dstId),
    ...inEdges.map((e) => e.srcId),
  ];

  if (neighbourIds.length === 0) return [];

  // Single query for all neighbour nodes (replaces the per-edge SELECT).
  const neighbourNodes = await db
    .select()
    .from(graphNodes)
    .where(inArray(graphNodes.id, neighbourIds));

  const nodeMap = new Map(neighbourNodes.map((n) => [n.id, n]));

  const results: Neighbor[] = [];

  for (const edge of outEdges) {
    const node = nodeMap.get(edge.dstId);
    if (node) results.push({ edge, node, direction: "out" });
  }

  for (const edge of inEdges) {
    const node = nodeMap.get(edge.srcId);
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

// ─────────────────────────────────────────────────────────────────────────────
// MRC-level aggregation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merged subgraph for all cities in an MRC.
 *
 * Queries QC_MUNICIPALITIES to resolve which city slugs belong to `mrc`, then
 * fetches all nodes + intra-MRC edges in a single pass.
 */
export interface MrcSubgraph {
  mrc: string;
  citySlugs: string[];
  nodes: (typeof graphNodes.$inferSelect)[];
  edges: (typeof graphEdges.$inferSelect)[];
}

/**
 * Return all graph nodes whose citySlug belongs to `mrc`, plus all edges where
 * BOTH endpoints are in that MRC node set.
 *
 * Returns empty nodes/edges (not an error) when no data has been ingested for
 * any city in the requested MRC.
 */
export async function subgraphForMrc(
  db: Database,
  mrc: string,
): Promise<MrcSubgraph> {
  // Resolve all city slugs that belong to this MRC (case-sensitive match on
  // the `mrc` field coming from QC_MUNICIPALITIES).
  const citySlugs = QC_MUNICIPALITIES
    .filter((m) => m.mrc === mrc)
    .map((m) => m.slug);

  if (citySlugs.length === 0) {
    return { mrc, citySlugs: [], nodes: [], edges: [] };
  }

  // Fetch all nodes for the MRC in one query.
  const nodes = await db
    .select()
    .from(graphNodes)
    .where(inArray(graphNodes.citySlug, citySlugs));

  if (nodes.length === 0) {
    return { mrc, citySlugs, nodes: [], edges: [] };
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const nodeIdList = Array.from(nodeIds);

  // Fetch candidate edges where srcId is in the MRC node set.
  const candidateEdges = await db
    .select()
    .from(graphEdges)
    .where(inArray(graphEdges.srcId, nodeIdList));

  // Keep only edges where both endpoints are inside the MRC node set.
  const edges = candidateEdges.filter((e) => nodeIds.has(e.dstId));

  return { mrc, citySlugs, nodes, edges };
}

/**
 * Summary entry for one MRC: how many nodes are stored + which city slugs are
 * represented.
 */
export interface MrcSummary {
  mrc: string;
  nodeCount: number;
  citySlugs: string[];
}

/**
 * List all MRCs that have at least one ingested graph node, with their node
 * count and city slugs. Sorted by nodeCount descending.
 *
 * Relies on QC_MUNICIPALITIES to resolve citySlug→mrc; cities with a null mrc
 * field (e.g. Westmount, agglomeration members) are skipped.
 */
export async function listMrcs(db: Database): Promise<MrcSummary[]> {
  // Build slug→mrc map from reference data (skip entries with null mrc).
  const slugToMrc = new Map<string, string>(
    QC_MUNICIPALITIES
      .filter((m): m is typeof m & { mrc: string } => m.mrc !== null && m.mrc !== undefined)
      .map((m) => [m.slug, m.mrc]),
  );

  // Fetch all distinct citySlug values that have nodes.
  const rows = await db
    .selectDistinct({ citySlug: graphNodes.citySlug })
    .from(graphNodes)
    .where(sql`${graphNodes.citySlug} IS NOT NULL`);

  // Count nodes per MRC.
  const mrcCities = new Map<string, { citySlugs: string[]; nodeCount: number }>();

  for (const { citySlug } of rows) {
    if (!citySlug) continue;
    const mrc = slugToMrc.get(citySlug);
    if (!mrc) continue; // city not in QC_MUNICIPALITIES or mrc is null

    if (!mrcCities.has(mrc)) {
      mrcCities.set(mrc, { citySlugs: [], nodeCount: 0 });
    }
    const entry = mrcCities.get(mrc)!;
    entry.citySlugs.push(citySlug);
  }

  // Enrich with actual node counts per MRC in batch.
  const summaries: MrcSummary[] = [];
  for (const [mrc, { citySlugs }] of mrcCities.entries()) {
    const countRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(graphNodes)
      .where(inArray(graphNodes.citySlug, citySlugs));
    const nodeCount = countRows[0]?.count ?? 0;
    summaries.push({ mrc, nodeCount, citySlugs: citySlugs });
  }

  return summaries.sort((a, b) => b.nodeCount - a.nodeCount);
}
