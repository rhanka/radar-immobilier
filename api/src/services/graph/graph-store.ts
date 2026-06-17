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
import { eq, or, sql, inArray, and, isNotNull } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { graphNodes, graphEdges } from "../../db/schema.js";
import { QC_MUNICIPALITIES } from "@radar/sources";

// ─────────────────────────────────────────────────────────────────────────────
// Zod schema for graphify graph.json
// ─────────────────────────────────────────────────────────────────────────────

const passthroughPropsSchema = z.record(z.unknown());

/** A single node as emitted by graphify. */
export const graphifyNodeSchema = z.object({
  id: z.string(),
  /**
   * graphify v1 always emits `label`. graphify v2 Source nodes sometimes omit
   * it (e.g. `{ id: "src:abc...", type: "Source" }`). We coerce null/undefined
   * to the empty string so the DB NOT NULL constraint is satisfied.
   */
  label: z.string().optional().default(""),
  /**
   * graphify v1 (old) emits `file_type`; graphify v2 (SCW) emits `type`.
   * Both are accepted and mapped to the DB `type` column.
   */
  file_type: z.string().optional(),
  /** graphify v2: node type (e.g. "Signal", "DesignationEvent", "Bylaw", …). */
  type: z.string().optional(),
  source_file: z.string().optional(),
  community: z.number().optional(),
  community_name: z.string().optional(),
  /** graphify v2: reconciliation status ("candidate", "validated", …). */
  status: z.string().optional(),
  /** graphify v2: textual description of the node. */
  description: z.string().optional(),
  /**
   * graphify v2: evidence refs list.
   * Shape varies across snapshots; kept as passthrough for props.
   * Some variants emit refs as string[] — strings are wrapped in { ref: s }.
   */
  refs: z
    .array(z.union([z.record(z.unknown()), z.string().transform((s) => ({ ref: s }))]))
    .optional(),
  /** Manual graphify extraction metadata kept nested in DB props. */
  properties: passthroughPropsSchema.optional(),
});

/** A single link / edge as emitted by graphify. */
export const graphifyLinkSchema = z.preprocess(
  (value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return value;
    }
    const record = value as Record<string, unknown>;
    // Normalise source/target aliases: src/tgt (v2 variant), from/to (v1 variant)
    const source = record.source ?? record.src ?? record.from;
    const target = record.target ?? record.tgt ?? record.to;
    // Normalise relation alias: `rel` used in some v2 variants
    const relation = record.relation ?? (record.rel !== undefined ? record.rel : undefined);
    return {
      ...record,
      source,
      target,
      ...(relation !== undefined ? { relation } : {}),
    };
  },
  z.object({
    source: z.string(),
    target: z.string(),
    /**
     * graphify v1 (old) emits `relation`; graphify v2 (SCW) emits `type` on
     * edges. We coerce both: `relation` takes priority when present (v1),
     * otherwise `type` is used (v2). At least one of the two is required.
     * Some v2 variants use `rel` which is normalised to `relation` in the
     * preprocess above.
     */
    relation: z.string().optional(),
    /** graphify v2: edge type field (used when `relation` is absent). */
    type: z.string().optional(),
    confidence: z.string().optional(),
    confidence_score: z.number().optional(),
    source_file: z.string().optional(),
    /**
     * graphify v2: evidence refs on edges.
     * Some v2 variants emit refs as string[] (citation strings) instead of
     * object[]. We accept both: strings are wrapped in `{ ref: s }` for
     * uniform storage.
     */
    refs: z
      .array(z.union([z.record(z.unknown()), z.string().transform((s) => ({ ref: s }))]))
      .optional(),
    /** Manual graphify extraction metadata kept nested in DB props. */
    properties: passthroughPropsSchema.optional(),
  }).refine(
    (v) => v.relation !== undefined || v.type !== undefined,
    { message: "edge must have either 'relation' or 'type'" },
  ),
);

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
  const { id, label, file_type, type: nodeType, source_file, community, community_name, status, description, refs, properties } = node;
  return {
    id,
    label,
    // v1: file_type; v2: type; fallback: "concept"
    type: file_type ?? nodeType ?? "concept",
    citySlug: citySlug ?? null,
    sourceRef: source_file ?? null,
    props: {
      ...(community !== undefined ? { community } : {}),
      ...(community_name !== undefined ? { community_name } : {}),
      ...(source_file !== undefined ? { source_file } : {}),
      // v2 extras — kept in props for forward compatibility
      ...(status !== undefined ? { status } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(refs !== undefined ? { refs } : {}),
      ...(properties !== undefined ? { properties } : {}),
    },
  };
}

/** Build a DB-shaped edge row from a graphify link. */
export function buildEdgeRow(link: GraphifyLink): EdgeRow {
  // v1 emits `relation`; v2 emits `type` for the edge kind. Non-null assert is
  // safe here because the Zod refine above guarantees at least one is present.
  const kind = link.relation ?? link.type!;
  const { source, target, confidence, confidence_score, source_file, refs, properties } = link;
  return {
    srcId: source,
    dstId: target,
    kind,
    props: {
      ...(confidence !== undefined ? { confidence } : {}),
      ...(confidence_score !== undefined ? { confidence_score } : {}),
      ...(source_file !== undefined ? { source_file } : {}),
      ...(refs !== undefined ? { refs } : {}),
      ...(properties !== undefined ? { properties } : {}),
    },
  };
}

function mergeRefs(a: unknown, b: unknown): unknown {
  if (!Array.isArray(a) && !Array.isArray(b)) return b ?? a;

  const refs = [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])];
  const seen = new Set<string>();
  const merged: unknown[] = [];

  for (const ref of refs) {
    const key = JSON.stringify(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(ref);
  }

  return merged;
}

function mergeProps(
  current: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...current, ...next };
  const refs = mergeRefs(current.refs, next.refs);
  if (refs !== undefined) merged.refs = refs;
  return merged;
}

/** Collapse duplicate node ids before bulk upsert. PostgreSQL rejects duplicate
 * conflict keys in a single INSERT ... ON CONFLICT batch. */
export function mergeNodeRows(rows: NodeRow[]): NodeRow[] {
  const byId = new Map<string, NodeRow>();

  for (const row of rows) {
    const current = byId.get(row.id);
    if (!current) {
      byId.set(row.id, row);
      continue;
    }

    byId.set(row.id, {
      ...current,
      ...row,
      props: mergeProps(current.props, row.props),
    });
  }

  return [...byId.values()];
}

/** Collapse duplicate edge natural keys before bulk upsert, preserving evidence
 * by merging refs from all duplicate graph edges. */
export function mergeEdgeRows(rows: EdgeRow[]): EdgeRow[] {
  const byKey = new Map<string, EdgeRow>();

  for (const row of rows) {
    const key = `${row.srcId}\u0000${row.dstId}\u0000${row.kind}`;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, row);
      continue;
    }

    byKey.set(key, {
      ...current,
      props: mergeProps(current.props, row.props),
    });
  }

  return [...byKey.values()];
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
  const links = [...(parsed.links ?? []), ...(parsed.edges ?? [])];

  const nodeRows = mergeNodeRows(parsed.nodes.map((n) => buildNodeRow(n, citySlug)));
  const edgeRows = mergeEdgeRows(links.map(buildEdgeRow));

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

// ─────────────────────────────────────────────────────────────────────────────
// Signal node read helpers (WP A.3.x)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Catégories sémantiques ZONAGE pour les nœuds de type `Signal`.
 *
 * Un signal est considéré ZONAGE si :
 *   - son type est `DesignationEvent` (toujours zonage), OU
 *   - son type est `Signal` ET sa catégorie (props->'properties'->>'category')
 *     appartient à cet ensemble.
 *
 * Les `Signal` sans catégorie (null/vide) ou avec une catégorie absente de cet
 * ensemble sont considérés NON-zonage.
 *
 * Sources : requête SQL prod 2026-06-14 sur graph_nodes (type='Signal').
 * Catégories incluses délibérément :
 *   - rezonage, derogation, derogation_mineure, piia, cptaq, ppcmoi,
 *     lotissement, subdivision, densification, usage_conditionnel,
 *     modification_zonage, changement_usage, zone_agricole,
 *     contrainte_reglementaire, patrimoine
 * Catégories EXCLUES (non-zonage) :
 *   - acquisition_fonciere, infrastructure, vente_terrain, vente_institutionnelle
 *     et toutes catégories sans lien direct avec la réglementation foncière.
 *
 * CATÉGORIES AMBIGUËS (présentes en prod, non incluses — à arbitrer si besoin) :
 *   amendement_zonage, modification_reglementaire, reglementation_urbanisme,
 *   plan_urbanisme, infraction_zonage, usage, urbanisme, gouvernance_urbanisme,
 *   developpement_residentiel, logement, logement_abordable, projet_particulier,
 *   reglementation, contrainte.
 *   Ces catégories existent en prod (1-5 occurrences chacune) mais n'étaient
 *   pas dans la liste de référence initiale.
 *
 * Pour ajuster la liste : modifier ce seul tableau. L'effet est immédiat au
 * prochain démarrage (aucune migration DB requise).
 */
export const ZONAGE_CATEGORIES: readonly string[] = [
  "rezonage",
  "derogation",
  "derogation_mineure",
  "piia",
  "cptaq",
  "ppcmoi",
  "lotissement",
  "subdivision",
  "densification",
  "usage_conditionnel",
  "modification_zonage",
  "changement_usage",
  "zone_agricole",
  "contrainte_reglementaire",
  "patrimoine",
];

/** Set pour lookup O(1) en application code. */
const ZONAGE_CATEGORIES_SET = new Set(ZONAGE_CATEGORIES);

/**
 * Détermine si un nœud signal (type + category) est de zonage.
 *
 * - `DesignationEvent` → toujours zonage
 * - `Signal` + category ∈ ZONAGE_CATEGORIES → zonage
 * - `Signal` sans category ou category hors liste → non-zonage
 */
export function isZonageSignal(type: string, category: string | null | undefined): boolean {
  if (type === "DesignationEvent") return true;
  if (type === "Signal" && category) return ZONAGE_CATEGORIES_SET.has(category);
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// ANTICIPATION — étape réglementaire dérivée par mots-clés
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Étapes réglementaires ordonnées du plus précoce (plus grande valeur
 * d'anticipation) au plus tardif.
 *
 * Étapes résolutions (DM / PIIA / PPCMOI) :
 *   - accorde / refuse : terminaux, donc après adoption (équivalent fonctionnel)
 *
 * Défaut : inconnu (aucun mot-clé reconnu).
 */
export type Etape =
  | "avis_motion"
  | "projet_reglement"
  | "consultation"
  | "second_projet"
  | "adoption"
  | "entree_vigueur"
  | "accorde"
  | "refuse"
  | "inconnu";

/**
 * Ordre d'anticipation : plus l'index est petit, plus l'étape est précoce
 * (= plus d'anticipation / de valeur pour le radar).
 * `inconnu` est traité à part (dernière position pour le tri).
 */
export const ETAPE_ORDER: Record<Etape, number> = {
  avis_motion:      0,
  projet_reglement: 1,
  consultation:     2,
  second_projet:    3,
  adoption:         4,
  entree_vigueur:   5,
  accorde:          6,
  refuse:           7,
  inconnu:          99,
};

/**
 * Étapes considérées comme « précoces » pour le toggle Anticipation.
 * = avis_motion OU projet_reglement (les deux premières étapes).
 */
export const ETAPES_PRECOCES: readonly Etape[] = ["avis_motion", "projet_reglement"];

/**
 * Dérive l'étape réglementaire d'un signal à partir du texte libre.
 *
 * Stratégie : recherche séquentielle des mots-clés dans l'ordre du plus
 * précis/précoce au plus tardif pour éviter les collisions (ex. « second
 * projet » matché avant « projet »). Le texte est normalisé en minuscules
 * sans accents avant la comparaison (robustesse encodage).
 *
 * Ambiguïtés signalées :
 *  - « projet de règlement » et « premier projet » → même étape projet_reglement
 *  - « accordé(e) » vs « accord » → on cible spécifiquement les formes "accorde"
 *    après normalisation NFD pour éviter les faux positifs (ex. « en accord avec »)
 *  - « en vigueur » présent dans « pas en vigueur » → gardé tel quel car cas rare
 *  - Les résolutions PIIA/PPCMOI « accordé » sont classées après adoption dans
 *    ETAPE_ORDER car elles représentent une décision terminale similaire.
 *
 * @param label       Libellé court du nœud signal.
 * @param description Description longue (props->'properties'->>'description').
 * @returns           Étape dérivée, défaut `inconnu`.
 */
export function deriveEtape(
  label: string | null | undefined,
  description: string | null | undefined,
): Etape {
  // Concatène label + description pour maximiser la couverture.
  const raw = `${label ?? ""} ${description ?? ""}`;
  // Normalise : minuscules + supprime les combinaisons d'accents unicode (é→e, è→e…)
  const text = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

  // ── Ordre de test : du plus précoce au plus tardif ──────────────────────
  // 1. avis de motion
  if (text.includes("avis de motion") || text.includes("avis d motion")) {
    return "avis_motion";
  }
  // 2. second projet (testé avant « projet » pour éviter la collision)
  if (
    text.includes("second projet") ||
    text.includes("2e projet") ||
    text.includes("deuxieme projet")
  ) {
    return "second_projet";
  }
  // 3. premier projet / projet de règlement / projet du règlement
  if (
    text.includes("premier projet") ||
    text.includes("1er projet") ||
    text.includes("projet de reglement") ||
    text.includes("projet du reglement")
  ) {
    return "projet_reglement";
  }
  // 4. consultation publique
  if (text.includes("consultation")) {
    return "consultation";
  }
  // 5. entré en vigueur / en vigueur (avant adoption pour éviter collision)
  if (
    text.includes("entree en vigueur") ||
    text.includes("entre en vigueur") ||
    text.includes("en vigueur")
  ) {
    return "entree_vigueur";
  }
  // 6. adoption / adopté
  if (
    text.includes("adoption") ||
    text.includes("adopte") ||
    text.includes("adoptee")
  ) {
    return "adoption";
  }
  // 7. accordé / accordée (résolutions DM / PIIA / PPCMOI)
  if (
    text.includes("accordee") ||
    text.includes("accorde") ||
    text.includes("autorise") ||
    text.includes("autorisee")
  ) {
    return "accorde";
  }
  // 8. refusé / refusée
  if (
    text.includes("refuse") ||
    text.includes("refusee") ||
    text.includes("rejete") ||
    text.includes("rejetee")
  ) {
    return "refuse";
  }

  return "inconnu";
}

/**
 * Détermine si un nœud Signal est de dimension 4+ (multifamilial).
 *
 * Règle :
 *   - `nb_unites_max` ≥ 4 (entier dans props->'properties'->>'nb_unites_max'), OU
 *   - `intensite` = 'haute' (signal à fort potentiel logements)
 *
 * Les `DesignationEvent` sont exclus (pas de champ nb_unites_max / intensite).
 *
 * @param type         Type de nœud ('Signal' ou 'DesignationEvent').
 * @param nbUnitesMax  Valeur string du champ nb_unites_max (peut être null).
 * @param intensite    Valeur string du champ intensite (peut être null).
 */
export function isMulti4Plus(
  type: string,
  nbUnitesMax: string | null | undefined,
  intensite: string | null | undefined,
): boolean {
  if (type !== "Signal") return false;
  if (intensite === "haute") return true;
  if (nbUnitesMax !== null && nbUnitesMax !== undefined && nbUnitesMax !== "") {
    const n = parseInt(nbUnitesMax, 10);
    if (!isNaN(n) && n >= 4) return true;
  }
  return false;
}

/**
 * Les 8 clés de sous-ensemble possibles pour {z, m, p}.
 * Ordre canonique : z < m < p (flags triés).
 * Valeur = nb de signaux satisfaisant TOUS les flags de la clé (intersection exacte).
 */
export type SubsetKey = "" | "z" | "m" | "p" | "z|m" | "z|p" | "m|p" | "z|m|p";

/** Construit la clé de sous-ensemble à partir d'un ensemble de flags actifs. */
export function buildSubsetKey(z: boolean, m: boolean, p: boolean): SubsetKey {
  const parts: string[] = [];
  if (z) parts.push("z");
  if (m) parts.push("m");
  if (p) parts.push("p");
  return parts.join("|") as SubsetKey;
}

/**
 * Détermine si l'étape d'un signal est « précoce » (avis_motion ou projet_reglement).
 *
 * Préfère le champ annoté `etape` (v2.1) quand présent dans
 * props->'properties'->>'etape'. Sinon fallback sur deriveEtape(label, description).
 */
export function isPrecoceSignal(
  etapeAnnote: string | null | undefined,
  label: string | null | undefined,
  description: string | null | undefined,
): boolean {
  const etape = (etapeAnnote?.trim() || undefined) ?? deriveEtape(label, description);
  return etape === "avis_motion" || etape === "projet_reglement";
}

/**
 * Count Signal + DesignationEvent nodes per city in graph_nodes.
 * Returns only cities that have at least one such node.
 *
 * Each city entry includes:
 *   - signalCount  : total count (all signals, all flags)
 *   - subsetCounts : exact intersection counts for each subset of {z, m, p} flags.
 *                    Keys: "", "z", "m", "p", "z|m", "z|p", "m|p", "z|m|p"
 *                    Value = nb signals satisfying ALL flags in the key.
 *                    isZonage (z) = DesignationEvent OR (Signal + category ∈ ZONAGE_CATEGORIES)
 *                    isMulti4 (m) = nb_unites_max ≥ 4 OR intensite = 'haute'
 *                    isPrecoce (p) = etape ∈ {avis_motion, projet_reglement}
 *                      (prefers props->'properties'->>'etape' annotation when present,
 *                       falls back to deriveEtape heuristic)
 */
export async function listCitiesWithSignalNodes(
  db: Database,
): Promise<Array<{
  citySlug: string;
  signalCount: number;
  subsetCounts: Record<SubsetKey, number>;
}>> {
  // One row per individual signal node (no count grouping in SQL) so we can
  // compute the 3 boolean flags per-signal and accumulate into subsetCounts.
  const rows = await db
    .select({
      citySlug: graphNodes.citySlug,
      type: graphNodes.type,
      category: sql<string | null>`${graphNodes.props}->'properties'->>'category'`,
      label: graphNodes.label,
      nbUnitesMax: sql<string | null>`${graphNodes.props}->'properties'->>'nb_unites_max'`,
      intensite: sql<string | null>`${graphNodes.props}->'properties'->>'intensite'`,
      description: sql<string | null>`${graphNodes.props}->'properties'->>'description'`,
      etapeAnnote: sql<string | null>`${graphNodes.props}->'properties'->>'etape'`,
    })
    .from(graphNodes)
    .where(
      and(
        inArray(graphNodes.type, ["Signal", "DesignationEvent"]),
        isNotNull(graphNodes.citySlug),
      ),
    );

  /** Initialise un subsetCounts vide pour une ville. */
  function emptySubsetCounts(): Record<SubsetKey, number> {
    return { "": 0, "z": 0, "m": 0, "p": 0, "z|m": 0, "z|p": 0, "m|p": 0, "z|m|p": 0 };
  }

  // Aggregate into per-city entries in application code.
  const byCity = new Map<string, {
    signalCount: number;
    subsetCounts: Record<SubsetKey, number>;
  }>();

  for (const row of rows) {
    if (!row.citySlug) continue;
    if (!byCity.has(row.citySlug)) {
      byCity.set(row.citySlug, {
        signalCount: 0,
        subsetCounts: emptySubsetCounts(),
      });
    }
    const entry = byCity.get(row.citySlug)!;
    entry.signalCount += 1;

    // Calcule les 3 flags booléens pour CE signal individuel.
    const z = isZonageSignal(row.type, row.category);
    const m = isMulti4Plus(row.type, row.nbUnitesMax, row.intensite);
    const p = isPrecoceSignal(row.etapeAnnote, row.label, row.description);

    // Incrémente TOUS les sous-ensembles dont les flags sont satisfaits par ce signal.
    // Un signal avec (z=true, m=false, p=true) contribue à : "", "z", "p", "z|p"
    for (const [kZ, kM, kP] of [
      [false, false, false],
      [true,  false, false],
      [false, true,  false],
      [false, false, true ],
      [true,  true,  false],
      [true,  false, true ],
      [false, true,  true ],
      [true,  true,  true ],
    ] as [boolean, boolean, boolean][]) {
      if ((!kZ || z) && (!kM || m) && (!kP || p)) {
        const key = buildSubsetKey(kZ, kM, kP);
        entry.subsetCounts[key] += 1;
      }
    }
  }

  return Array.from(byCity.entries()).map(([citySlug, data]) => ({
    citySlug,
    signalCount: data.signalCount,
    subsetCounts: data.subsetCounts,
  }));
}

/**
 * Fetch Signal + DesignationEvent nodes for a given city from graph_nodes.
 * Returns empty array when no such nodes exist for the city (anti-invention).
 */
export async function getSignalNodesForCity(
  db: Database,
  citySlug: string,
): Promise<Array<typeof graphNodes.$inferSelect>> {
  return db
    .select()
    .from(graphNodes)
    .where(
      and(
        inArray(graphNodes.type, ["Signal", "DesignationEvent"]),
        eq(graphNodes.citySlug, citySlug),
      ),
    );
}
