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
import { eq, or, sql, inArray, notInArray, and, isNotNull } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { graphNodes, graphEdges } from "../../db/schema.js";
import { QC_MUNICIPALITIES } from "@radar/sources";
import { classifyBPrime, deriveRegulatoryStatus, type RegulatoryStageKindT } from "@radar/domain";
import {
  computeLegacySubsetCounts,
  computeVivierV2,
  extractLegacyZmpInput,
  classifyLegacyZmpSignal,
  classifyVivierSignal,
  type VivierSignalInput,
} from "./vivier-v2.js";

export {
  classifyVivierSignal,
  computeLegacySubsetCounts,
  computeVivierV2,
  buildLegacyZmpProjection,
} from "./vivier-v2.js";

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
  municipality: z.string().optional(),
  ontology_version: z.enum(["2.0", "2.1", "2.2", "2.3"]).optional(),
  graphify_pass: z.literal("3.4").optional(),
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
  // v1: file_type; v2: type; fallback: "concept"
  const type = file_type ?? nodeType ?? "concept";
  // LOT 1 serving (D-INT/D1/D2, P2) — persist the DERIVED regulatoryStatus at MATÉRIALISATION,
  // recomputed at every write from the authoritative statut/etape via THE single classifier
  // `deriveRegulatoryStatus`. Source de vérité DATA (lue par les consommateurs, pas re-dérivée
  // serve-time). Co-localisé avec `etape` dans `props.properties` (lecture symétrique
  // `props->'properties'->>'regulatoryStatus'` + couvert par le guard no-disparition
  // DEGRADATION_SENSITIVE_KEYS) ; jamais clobbé par une ré-extraction raw car RE-CALCULÉ ici à
  // chaque matérialisation (le spread écrase toute valeur stale).
  const rawProps = (properties ?? undefined) as Record<string, unknown> | undefined;
  const etape = (rawProps?.etape ?? null) as string | null;
  const statut = (rawProps?.statut ?? null) as RegulatoryStageKindT | null;
  // Gate anti-invention : QUE les nœuds portant un STADE (`etape` ou `statut`) — la classification
  // se DÉRIVE du stade, donc sans stade il n'y a rien à dériver. Un nœud non-règlement (Zone/Lot/
  // Concept) ou un nœud incomplet sans stade ne reçoit jamais un `regulatoryStatus` spurieux (le
  // consommateur applique le fallback anticipation-conservateur à la lecture d'un champ absent).
  const isLifecycle = etape != null || statut != null;
  const enrichedProperties = isLifecycle
    ? { ...(rawProps ?? {}), regulatoryStatus: deriveRegulatoryStatus({ statut, etape }) }
    : properties;
  return {
    id,
    label,
    type,
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
      ...(enrichedProperties !== undefined ? { properties: enrichedProperties } : {}),
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
// Completeness gate (pure — unit-testable without DB)
// ─────────────────────────────────────────────────────────────────────────────

/** Types de nœuds porteurs de preuves (signaux). */
const SIGNAL_NODE_TYPES = new Set(["Signal", "DesignationEvent"]);

/** Clés candidates pour une citation/excerpt dans une ref. */
const REF_CITATION_KEYS = ["excerpt", "citation", "quote", "text"] as const;
/** Clés candidates pour une preuve PDF (rawRef) dans une ref. */
const REF_RAWREF_KEYS = [
  "rawRef",
  "raw_ref",
  "rawObjectKey",
  "raw_object_key",
  "file",
  "ref",
  "sourceRef",
  "source_ref",
  "path",
  "s3Key",
  "s3_key",
] as const;

function firstNonEmptyString(
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return true;
  }
  return false;
}

/**
 * Une ref « provisional » est un lien posé AUTOMATIQUEMENT par le filet Radar
 * (`provisional: true` et/ou `linkSource: "radar-auto-link"`). Elle ne constitue
 * PAS une preuve graphify vérifiée : on l'exclut du calcul anti-régression
 * (cf. `countCompleteSignals(..., { ignoreProvisional: true })`) afin qu'un lien
 * provisional n'élève jamais le seuil de complétude et donc ne bloque jamais une
 * reprojection graphify légitime. En revanche, hors anti-régression, un
 * provisional avec citation+rawRef compte bien comme « complet » (il rend la
 * preuve affichable au client).
 */
function isProvisionalRef(r: Record<string, unknown>): boolean {
  if (r.provisional === true || r.provisional === "true") return true;
  const ls = r.linkSource ?? r.link_source;
  return typeof ls === "string" && ls.trim() === "radar-auto-link";
}

/**
 * Un node de signal est « complet »/preuve-vivante quand il porte AU MOINS une
 * ref contenant à la fois une citation/excerpt ET un rawRef (preuve PDF).
 *
 * Une ref string nue (`"abc.pdf"`) compte comme rawRef SANS citation → ne suffit
 * PAS à elle seule. Le top-level props (clés citation/excerpt + file/ref) est
 * aussi considéré comme une « ref » implicite.
 *
 * Règle d'or (anti-régression) : on n'écrase JAMAIS une citation/rawRef présente
 * par du vide. En cas de régression de ce compte, la ville est abortée (cf.
 * upsertGraphAtomic).
 */
export function isCompleteSignalProps(
  props: Record<string, unknown>,
  options: { ignoreProvisional?: boolean } = {},
): boolean {
  const { ignoreProvisional = false } = options;
  const refs = props.refs;
  if (Array.isArray(refs)) {
    for (const item of refs) {
      if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
      const r = item as Record<string, unknown>;
      // Anti-régression : une ref provisional (filet Radar) ne compte pas comme
      // preuve « dure » — sinon elle élèverait le seuil et bloquerait une
      // reprojection graphify ultérieure sans rawRef.
      if (ignoreProvisional && isProvisionalRef(r)) continue;
      if (firstNonEmptyString(r, REF_CITATION_KEYS) && firstNonEmptyString(r, REF_RAWREF_KEYS)) {
        return true;
      }
    }
  }
  // Repli : citation + rawRef portés directement au niveau racine des props.
  if (ignoreProvisional && isProvisionalRef(props)) return false;
  if (firstNonEmptyString(props, REF_CITATION_KEYS) && firstNonEmptyString(props, REF_RAWREF_KEYS)) {
    return true;
  }
  return false;
}

/**
 * Compte les nœuds de signal « complets » (Signal/DesignationEvent avec au moins
 * une ref citation+rawRef) parmi un ensemble de NodeRow. Pur, sans DB.
 *
 * Avec `{ ignoreProvisional: true }` (calcul anti-régression du gate), les liens
 * provisional du filet Radar sont exclus : ils n'élèvent pas le seuil et ne
 * peuvent donc jamais faire aborter une reprojection graphify légitime.
 */
export function countCompleteSignals(
  nodeRows: Array<{ type: string; props: Record<string, unknown> }>,
  options: { ignoreProvisional?: boolean } = {},
): number {
  let count = 0;
  for (const row of nodeRows) {
    if (!SIGNAL_NODE_TYPES.has(row.type)) continue;
    if (isCompleteSignalProps(row.props, options)) count++;
  }
  return count;
}

export interface BusinessPropertyRegression {
  citySlug: string;
  nodeId: string;
  missingKeys: string[];
}

type BusinessPropertySnapshotRow = {
  id: string;
  props: Record<string, unknown>;
};

function businessProperties(props: Record<string, unknown>): Record<string, unknown> {
  const nested = props.properties;
  return typeof nested === "object" && nested !== null && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : {};
}

/**
 * The classified fields Graphify 3.4 phase A writes. ONLY these keys get the
 * degradation check below.
 *
 * The check must not be universal. `autre` and `""` are legitimate DOMAIN
 * VALUES elsewhere: `ZoneKind` includes `autre`
 * (`packages/radar-domain/src/schemas/ontology/entities.ts`), and
 * `zoneKindOf()` returns it on purpose for a real multi-letter family such as
 * `REC-137` (`packages/radar-sources/src/sources/reglements-urbanisme-parser.ts`).
 * A universal rule would refuse the projection of an entire city because one
 * zone legitimately moved `H` → `autre`, or because a `notes` field was
 * intentionally cleared. A gate that blocks legitimate work is not a safer
 * gate: it is a gate someone disables during the first incident.
 *
 * For these three keys the sentinel is not a value anyone means: it is what the
 * classifier returns when it recognises nothing, which is exactly how phase A
 * crushed 13 informative `instrument` values.
 */
const DEGRADATION_SENSITIVE_KEYS = new Set(["effet_densifiant", "etape", "instrument"]);

/**
 * The uninformative fallbacks a classifier emits when it recognises nothing.
 *
 * The set is the UNION of the three keys' fallbacks, because each classifier
 * spells "I recognised nothing" differently:
 *   - `instrumentFromSignal()` returns `"autre"` (`vivier-v2.ts`);
 *   - `deriveEtape()` returns `"inconnu"` (below) — never `"autre"`, never `""`;
 *   - `effectFromSignal()` returns `"inconnu"` (`vivier-v2.ts`), whose only
 *     legitimate values are `densifie|reduit|stable|inconnu`.
 * Listing only `""` and `"autre"` therefore left two keys out of three guarding
 * nothing at all: `etape: "adoption" → "inconnu"` passed the gate unnoticed,
 * which is the original defect replayed on the two other fields.
 *
 * The union creates no false positive on the keys it does not belong to:
 * `"inconnu"` is not a `VivierInstrument` and `"autre"` is neither a
 * `VivierEtape` nor an effect, so no producer can emit them there. And a
 * degradation is only ever reported when the BEFORE value is informative — a
 * node already sitting on `inconnu` reads as absent on both sides and is
 * exempt, so re-running a projection over unclassified nodes stays silent.
 */
const DEGRADED_STRING_VALUES = new Set(["", "autre", "inconnu"]);

function hasBusinessProperty(properties: Record<string, unknown>, key: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(properties, key)) return false;
  const value = properties[key];
  if (value === null || value === undefined) return false;
  if (!DEGRADATION_SENSITIVE_KEYS.has(key)) return true;
  if (typeof value !== "string") return true;
  return !DEGRADED_STRING_VALUES.has(value.trim().toLowerCase());
}

/**
 * Find business values present on the current city snapshot but absent — or,
 * for the three classified keys above, degraded — in the candidate snapshot,
 * one node at a time. Every key under `props.properties` stays protected
 * against DISAPPEARING: this deliberately does not maintain a lossy allow-list
 * for presence.
 *
 * A missing node is treated as an empty property map, so a complete snapshot
 * cannot silently delete a business-bearing node. Values `false`, `0`, empty
 * strings, and empty arrays remain present for every key outside
 * `DEGRADATION_SENSITIVE_KEYS`; only an absent/null/undefined key is a
 * regression there. On `effet_densifiant`, `etape` and `instrument`, an
 * informative string collapsed to a classifier fallback (`""`, `autre`,
 * `inconnu`) is also a regression: the key survives but the business
 * information is gone.
 */
export function findMissingBusinessProperties(
  beforeRows: readonly BusinessPropertySnapshotRow[],
  afterRows: readonly BusinessPropertySnapshotRow[],
  citySlug: string,
  intendedRemovals: ReadonlySet<string> = new Set(),
): BusinessPropertyRegression[] {
  const afterById = new Map(afterRows.map((row) => [row.id, row]));
  const regressions: BusinessPropertyRegression[] = [];

  for (const beforeRow of beforeRows) {
    // A removal-only reprojection deletes some nodes ON PURPOSE (e.g.
    // purge-avis-bylaws). For those the disappearance of every business key is
    // intended, not a silent regression — skip them. The anti-silent-deletion
    // guard stays armed for EVERY other node (accidental drop / drift → abort).
    if (intendedRemovals.has(beforeRow.id)) continue;
    const before = businessProperties(beforeRow.props);
    const after = businessProperties(afterById.get(beforeRow.id)?.props ?? {});
    const missingKeys = Object.keys(before)
      .filter((key) => hasBusinessProperty(before, key) && !hasBusinessProperty(after, key))
      .sort();
    if (missingKeys.length > 0) {
      regressions.push({ citySlug, nodeId: beforeRow.id, missingKeys });
    }
  }

  return regressions;
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
// Projection atomique par ville (anti preuves-fantômes + gate de complétude)
// ─────────────────────────────────────────────────────────────────────────────

/** Erreur sentinelle servant à rollbacker la transaction d'une ville régressée. */
class GraphCompletenessAbort extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphCompletenessAbort";
  }
}

export interface UpsertAtomicResult {
  /** Nombre de nœuds projetés (présents dans le nouveau graphe). */
  nodeCount: number;
  /** Nombre d'arêtes projetées. */
  edgeCount: number;
  /** Nombre de nœuds orphelins supprimés (disparus du nouveau graphe). */
  deletedNodes: number;
  /** Nombre d'arêtes pendantes supprimées (référençant un nœud supprimé). */
  deletedEdges: number;
  /** true si la ville a été abortée (rollback) suite à une régression de preuves. */
  aborted: boolean;
  /** Message d'alerte loggable quand aborted=true (ou skip cross-city). */
  reason?: string;
}

/**
 * Projection ATOMIQUE d'un graphe city-scoped dans Postgres (tout-ou-rien).
 *
 * Contrairement à `upsertGraph` (upsert pur, conserve indéfiniment les nœuds
 * disparus → « preuves fantômes »), cette variante exécute dans UNE transaction
 * par ville :
 *   1. upsert des nœuds/arêtes présents (conserve l'existant, idempotent) ;
 *   2. SUPPRESSION des nœuds de cette `city_slug` ABSENTS du nouveau graphe ;
 *   3. SUPPRESSION des arêtes devenues pendantes (référençant un nœud qu'on vient
 *      de supprimer) et qui ne sont pas dans le nouveau graphe ;
 *   4. GATE DE PROPRIÉTÉS MÉTIER : si une clé existante sous
 *      `props.properties` disparaît pour un nœud, la ville est refusée avant
 *      toute écriture ;
 *   5. GATE DE COMPLÉTUDE : si le nombre de signaux « complets » (Signal/
 *      DesignationEvent avec ref citation+rawRef) APRÈS < AVANT, la transaction
 *      est ABORTÉE (rollback). On n'écrase JAMAIS une citation/rawRef présente
 *      par du vide ; en cas de régression on aborte la ville (le plus sûr).
 *
 * Cas `citySlug === null` (nœuds cross-city/globaux) : AUCUNE suppression n'est
 * effectuée (impossible de scoper sûrement la suppression sans risquer d'effacer
 * des nœuds d'autres villes) — on se contente d'un upsert pur, comme `upsertGraph`.
 *
 * La fonction NE throw PAS en cas d'abort (les autres villes doivent continuer) :
 * elle retourne `{ aborted: true, reason }`. Elle peut throw sur erreur DB
 * inattendue (laissée remonter à l'appelant pour comptage `errors`).
 *
 * @param db       Drizzle database handle
 * @param citySlug City scope injecté sur chaque nœud (null = cross-city → pas de suppression)
 * @param graphJson Objet brut (validé via graphifyGraphSchema)
 */
export async function upsertGraphAtomic(
  db: Database,
  citySlug: string | null,
  graphJson: unknown,
  /**
   * Node ids this projection deletes ON PURPOSE (removal-only tools such as
   * purge-avis-bylaws). They are exempt from the business-property-regression
   * guard — their disappearance is intended, not a silent data loss. Every
   * OTHER node stays guarded. Default empty = current strict behaviour.
   */
  intendedRemovals: ReadonlySet<string> = new Set(),
): Promise<UpsertAtomicResult> {
  const parsed = graphifyGraphSchema.parse(graphJson);
  const links = [...(parsed.links ?? []), ...(parsed.edges ?? [])];

  const nodeRows = mergeNodeRows(parsed.nodes.map((n) => buildNodeRow(n, citySlug)));
  const edgeRows = mergeEdgeRows(links.map(buildEdgeRow));
  const newNodeIds = nodeRows.map((r) => r.id);

  // Cas cross-city : upsert pur, aucune suppression (impossible de scoper sûrement).
  if (citySlug === null) {
    const base = await upsertGraph(db, citySlug, graphJson);
    return {
      nodeCount: base.nodeCount,
      edgeCount: base.edgeCount,
      deletedNodes: 0,
      deletedEdges: 0,
      aborted: false,
      reason: "cross-city (citySlug=null) : upsert pur sans suppression",
    };
  }

  let result: UpsertAtomicResult = {
    nodeCount: nodeRows.length,
    edgeCount: edgeRows.length,
    deletedNodes: 0,
    deletedEdges: 0,
    aborted: false,
  };

  // Compte des signaux complets AVANT projection (état PG actuel de la ville),
  // mesuré hors-transaction pour servir de référence au gate de non-régression.
  const beforeRows = await db
    .select({ id: graphNodes.id, type: graphNodes.type, props: graphNodes.props })
    .from(graphNodes)
    .where(eq(graphNodes.citySlug, citySlug));
  const completeBefore = countCompleteSignals(
    beforeRows.map((r) => ({
      type: r.type,
      props: (r.props ?? {}) as Record<string, unknown>,
    })),
    { ignoreProvisional: true },
  );

  const propertyRegressions = findMissingBusinessProperties(
    beforeRows.map((row) => ({ id: row.id, props: (row.props ?? {}) as Record<string, unknown> })),
    nodeRows,
    citySlug,
    intendedRemovals,
  );
  if (propertyRegressions.length > 0) {
    const details = propertyRegressions
      .map(({ nodeId, missingKeys }) => `${nodeId}: ${missingKeys.join(", ")}`)
      .join("; ");
    return {
      ...result,
      aborted: true,
      reason:
        `business-property regression for ${citySlug}: ` +
        `existing values would disappear or degrade (${details}); projection refused`,
    };
  }

  try {
    await db.transaction(async (tx) => {
      // 1. upsert nœuds (ON CONFLICT pk = id)
      if (nodeRows.length > 0) {
        await tx
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

      // 2. upsert arêtes (ON CONFLICT clé naturelle src_id,dst_id,kind)
      if (edgeRows.length > 0) {
        await tx
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
            set: { props: sql`excluded.props` },
          });
      }

      // 3. SUPPRESSION des nœuds orphelins de CETTE ville (jamais les null, jamais
      //    une autre ville). Récupère d'abord leurs ids pour purger leurs arêtes.
      const orphanCond =
        newNodeIds.length > 0
          ? and(eq(graphNodes.citySlug, citySlug), notInArray(graphNodes.id, newNodeIds))
          : eq(graphNodes.citySlug, citySlug);

      const orphanRows = await tx
        .select({ id: graphNodes.id })
        .from(graphNodes)
        .where(orphanCond);
      const orphanIds = orphanRows.map((r) => r.id);

      if (orphanIds.length > 0) {
        // 4. SUPPRESSION des arêtes pendantes : src_id OU dst_id pointe vers un
        //    nœud orphelin qu'on supprime. Prudence : on ne touche QUE celles-là.
        const danglingEdges = await tx
          .delete(graphEdges)
          .where(
            or(
              inArray(graphEdges.srcId, orphanIds),
              inArray(graphEdges.dstId, orphanIds),
            ),
          )
          .returning({ id: graphEdges.id });
        result.deletedEdges = danglingEdges.length;

        const deleted = await tx
          .delete(graphNodes)
          .where(
            and(eq(graphNodes.citySlug, citySlug), inArray(graphNodes.id, orphanIds)),
          )
          .returning({ id: graphNodes.id });
        result.deletedNodes = deleted.length;
      }

      // 5. GATE DE COMPLÉTUDE : compte les signaux complets APRÈS projection
      //    (état projeté, dans la transaction) et compare à AVANT (count calculé
      //    sur l'état PG d'origine, hors transaction). Si APRÈS < AVANT → rollback.
      const afterSignalRows = await tx
        .select({ type: graphNodes.type, props: graphNodes.props })
        .from(graphNodes)
        .where(
          and(
            eq(graphNodes.citySlug, citySlug),
            inArray(graphNodes.type, ["Signal", "DesignationEvent"]),
          ),
        );
      const completeAfter = countCompleteSignals(
        afterSignalRows.map((r) => ({
          type: r.type,
          props: (r.props ?? {}) as Record<string, unknown>,
        })),
        { ignoreProvisional: true },
      );

      if (completeAfter < completeBefore) {
        result = {
          ...result,
          deletedNodes: 0,
          deletedEdges: 0,
          aborted: true,
          reason:
            `régression de preuves pour ${citySlug} : signaux complets ` +
            `${completeBefore} → ${completeAfter} (rollback, projection ignorée)`,
        };
        // Annule TOUTE la transaction de cette ville (upsert + suppressions).
        throw new GraphCompletenessAbort(result.reason!);
      }
    });
  } catch (err) {
    if (err instanceof GraphCompletenessAbort) {
      // Abort attendu : la transaction a été rollbackée, on retourne le résultat
      // marqué aborted sans propager (les autres villes continuent).
      return result;
    }
    throw err;
  }

  return result;
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
  // `created_at` est OMIS volontairement : il n'est utilisé par aucun
  // consommateur (nodeFromDb/edgeFromDb/routes/enrichment) et la colonne peut
  // être absente sur certains déploiements (drift schema OVH). On ne
  // sélectionne donc que les colonnes réellement lues.
  nodes: Omit<typeof graphNodes.$inferSelect, "createdAt">[];
  edges: Omit<typeof graphEdges.$inferSelect, "createdAt">[];
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
    .select({
      id: graphNodes.id,
      type: graphNodes.type,
      label: graphNodes.label,
      citySlug: graphNodes.citySlug,
      props: graphNodes.props,
      sourceRef: graphNodes.sourceRef,
    })
    .from(graphNodes)
    .where(eq(graphNodes.citySlug, citySlug));

  if (nodes.length === 0) {
    return { citySlug, nodes: [], edges: [] };
  }

  const nodeIds = new Set(nodes.map((n) => n.id));

  // Pull all edges where src is in the city set; filter dstId in application
  // layer (avoids a large IN clause for small graphs).
  const candidateEdges = await db
    .select({
      id: graphEdges.id,
      srcId: graphEdges.srcId,
      dstId: graphEdges.dstId,
      kind: graphEdges.kind,
      props: graphEdges.props,
    })
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
 * Détermine si un nœud signal (type + category + etape) est de zonage.
 *
 * - `DesignationEvent` → toujours zonage
 * - `Signal` + category ∈ ZONAGE_CATEGORIES → zonage
 * - `Signal` + etape ∈ ZONAGE_CATEGORIES → zonage  (replis sur l'étape annotée)
 * - `Signal` sans category NI etape de zonage → non-zonage
 *
 * Élargissement (#4 — filtre zonage trop strict) : ~1700/3294 Signal ont
 * `category=NULL` en prod alors que leur `etape` annotée (v2.1) porte une valeur
 * de zonage (ex. `derogation_mineure`). Tester uniquement `category` masquait
 * ces dérogations légitimes (ex. saint-anicet : 9 signaux `etape=derogation_mineure`,
 * `category=NULL`). On accepte donc l'une OU l'autre source, sur le même
 * vocabulaire ZONAGE_CATEGORIES.
 */
export function isZonageSignal(
  type: string,
  category: string | null | undefined,
  etape?: string | null | undefined,
): boolean {
  if (type === "DesignationEvent") return true;
  if (type !== "Signal") return false;
  if (category && ZONAGE_CATEGORIES_SET.has(category)) return true;
  if (etape && ZONAGE_CATEGORIES_SET.has(etape)) return true;
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

// ─────────────────────────────────────────────────────────────────────────────
// PERTINENCE RÉSIDENTIELLE — filtre de bruit non-résidentiel (I2 / S2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classification de la pertinence « densification résidentielle » d'un signal.
 *
 * Retour métier (Steve) : ~4 villes sur 30 sont du BRUIT PUR pour un développeur
 * résidentiel (parc industriel, zone commerciale, camping, milieux humides /
 * zones inondables / environnemental). On étiquette donc chaque signal pour
 * pouvoir MASQUER ce bruit sans perdre les signaux réels.
 *
 *   - `residentiel`     : marqueur résidentiel/densification explicite.
 *   - `non_residentiel` : marqueur non-résidentiel explicite ET aucun marqueur
 *                         résidentiel (mixte = opportunité → reste résidentiel).
 *   - `indetermine`     : aucun marqueur reconnu → dans le DOUTE on NE tranche
 *                         PAS (anti-invention, pas de faux négatif silencieux).
 */
export type ResidentielPertinence = "residentiel" | "non_residentiel" | "indetermine";

/**
 * Catégories (props.properties.category / etape annotée) intrinsèquement
 * résidentielles. Élargir ce tableau suffit à ajuster la classification.
 */
export const RESIDENTIEL_CATEGORIES: readonly string[] = [
  "densification",
  "developpement_residentiel",
  "logement",
  "logement_abordable",
  "habitation",
];
const RESIDENTIEL_CATEGORIES_SET = new Set(RESIDENTIEL_CATEGORIES);

/**
 * Marqueurs TEXTE résidentiels (label + description, normalisés minuscule sans
 * accents). Verbatim, haute précision — pas de mot ambigu (« maison » nu exclu :
 * « maison de la culture » n'est pas de l'habitation ; « plex » borné par \b
 * pour ne pas matcher « complexe »).
 */
const RESIDENTIEL_MARKERS_RE =
  /\b(?:residentiel(?:le)?s?|habitation|logement|multilogement|multi-logement|multifamilial(?:e)?s?|bifamilial(?:e)?s?|trifamilial(?:e)?s?|unifamilial(?:e)?s?|plurifamilial(?:e)?s?|densification|duplex|triplex|quadruplex|plex|condominium|maison de chambres|immeuble (?:residentiel|locatif|a logements)|usage mixte)\b/;

/**
 * Marqueurs TEXTE non-résidentiels (bruit pour un développeur résidentiel). Ne
 * tranchent `non_residentiel` QUE si AUCUN marqueur résidentiel n'est présent
 * (un rezonage « de commercial à résidentiel » ou un usage mixte reste une
 * opportunité). `agricole` est inclus mais protégé par la même règle : une
 * exclusion CPTAQ « à des fins résidentielles » porte le marqueur résidentiel.
 */
// Lexique résidentiel SERVEUR (axe A / `r`) — STRICTEMENT INDÉPENDANT du lexique
// franc-non-résidentiel B′ (`FRANC_NON_RESIDENTIEL_SOURCE`). Ne PAS le fusionner
// avec la source partagée B′ : `classifyResidentielPertinence` est l'axe
// résidentiel de A et doit rester invariant (golden testé). Le durcissement R3
// (« commerciaux », enseigne/affichage) vit UNIQUEMENT côté B′ (b-prime.ts +
// vivier-v2.ts), jamais ici.
const NON_RESIDENTIEL_MARKERS_RE =
  /\b(?:industriel(?:le)?s?|parc industriel|zone industrielle|commercial(?:e)?s?|centre commercial|camping|agricole|exploitation agricole|terres? agricoles?|environnement(?:al(?:e)?)?|milieux? humides?|zone inondable|plaine inondable|inondable|conservation|bande riveraine|riveraine|eolien(?:ne)?s?|minier(?:e)?s?|carriere|graviere|sabliere|entreposage|entrepot|stationnement)\b/;

/** Normalise un texte : minuscule + suppression des accents (é→e, è→e…). */
function foldText(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Classifie la pertinence résidentielle d'un signal à partir de sa catégorie et
 * de son texte libre (label + description). Priorité au résidentiel (le mixte et
 * les conversions « X → résidentiel » sont des opportunités). Défaut prudent :
 * `indetermine` — jamais un faux `non_residentiel` silencieux.
 */
export function classifyResidentielPertinence(
  category: string | null | undefined,
  label: string | null | undefined,
  description: string | null | undefined,
): ResidentielPertinence {
  if (category && RESIDENTIEL_CATEGORIES_SET.has(category)) return "residentiel";
  const text = foldText(`${label ?? ""} ${description ?? ""}`);
  if (RESIDENTIEL_MARKERS_RE.test(text)) return "residentiel";
  if (NON_RESIDENTIEL_MARKERS_RE.test(text)) return "non_residentiel";
  return "indetermine";
}

/**
 * Prédicat du FILTRE de pertinence résidentielle (axe `r`).
 *
 * Anti-faux-négatif : le filtre ne retire QUE le bruit EXPLICITEMENT non
 * résidentiel. Un signal `residentiel` OU `indetermine` PASSE (on ne masque
 * jamais un signal dans le doute) ; seul `non_residentiel` est écarté.
 */
export function isResidentielPertinent(
  category: string | null | undefined,
  label: string | null | undefined,
  description: string | null | undefined,
): boolean {
  return classifyResidentielPertinence(category, label, description) !== "non_residentiel";
}

/**
 * Les 16 clés de sous-ensemble possibles pour {z, m, p, r}.
 * Ordre canonique : z < m < p < r (flags triés).
 * Valeur = nb de signaux satisfaisant TOUS les flags de la clé (intersection exacte).
 */
export type SubsetKey =
  | ""
  | "z" | "m" | "p" | "r"
  | "z|m" | "z|p" | "z|r" | "m|p" | "m|r" | "p|r"
  | "z|m|p" | "z|m|r" | "z|p|r" | "m|p|r"
  | "z|m|p|r";

/**
 * Construit la clé de sous-ensemble à partir des flags actifs.
 *
 * `r` (pertinence résidentielle) est un 4e axe OPTIONNEL : quand il vaut `false`
 * la sortie est identique au modèle {z,m,p} historique (rétro-compatibilité des
 * appelants à 3 arguments et des clés déjà persistées en URL/localStorage).
 */
export function buildSubsetKey(z: boolean, m: boolean, p: boolean, r = false): SubsetKey {
  const parts: string[] = [];
  if (z) parts.push("z");
  if (m) parts.push("m");
  if (p) parts.push("p");
  if (r) parts.push("r");
  return parts.join("|") as SubsetKey;
}

/**
 * Les 16 combinaisons de flags {z,m,p,r} (bitmask) — source unique pour
 * `emptySubsetCounts` et l'accumulation par ville (évite les typos d'un tableau
 * littéral de 16 lignes).
 */
const SUBSET_FLAG_COMBOS: ReadonlyArray<[boolean, boolean, boolean, boolean]> =
  Array.from({ length: 16 }, (_unused, mask) => [
    (mask & 1) !== 0,
    (mask & 2) !== 0,
    (mask & 4) !== 0,
    (mask & 8) !== 0,
  ]);

export interface GraphSignalClassificationInput {
  id: string;
  type: string;
  category: string | null;
  label: string | null;
  description: string | null;
  etapeAnnote: string | null;
  props: unknown;
  sourceRef: string | null;
}

/** Build the versioned classification from the same graph row used by A/B counts. */
export function classifyGraphNodeVivierV2(
  input: GraphSignalClassificationInput,
): ReturnType<typeof classifyVivierSignal> {
  const signal: VivierSignalInput = {
    id: input.id,
    type: input.type,
    category: input.category,
    label: input.label,
    description: input.description,
    etape: input.etapeAnnote,
    props: input.props,
    sourceRef: input.sourceRef,
  };
  return classifyVivierSignal(signal);
}

/** Build legacy membership from the same graph card input as aggregate counts. */
export function classifyGraphNodeLegacyZmp(
  input: Pick<GraphSignalClassificationInput, "id" | "type" | "label" | "props" | "sourceRef">,
): ReturnType<typeof classifyLegacyZmpSignal> {
  return classifyLegacyZmpSignal(extractLegacyZmpInput(input));
}

/**
 * Détermine si l'étape d'un signal est « précoce » (avis_motion ou projet_reglement).
 *
 * Preserve the legacy A predicate: prefer an annotated stage when present and
 * otherwise derive it from the label/description. B′ has its own stage audit
 * and must not change the persisted z|m|p membership contract.
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
 *
 * The query is one projection. Each row is classified once for the new
 * contract and contributes to the unchanged legacy rail from the same row;
 * there is no A/B data fork. `vivierV2Counts.stageCounts` only counts
 * `qualified` rows.
 */
export interface GraphSignalProjectionRow {
  id: string;
  citySlug: string | null;
  type: string;
  category?: string | null;
  label: string;
  nbUnitesMax?: string | null;
  intensite?: string | null;
  description?: string | null;
  etapeAnnote?: string | null;
  props: unknown;
  sourceRef: string | null;
}

export interface GraphSignalDateRange {
  dateFrom?: string;
  dateTo?: string;
}

const SIGNAL_DATE_KEYS = [
  "etapeDate",
  "etape_date",
  "meetingDate",
  "meeting_date",
  "documentDate",
  "date",
] as const;

function signalRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseServerSignalDate(value: string): Date | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const parsed = new Date(year, month - 1, day);
    return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
      ? parsed
      : null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseServerSignalBoundary(value: string, endOfDay: boolean): Date | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!dateOnly) return parseServerSignalDate(value);

  const year = Number(dateOnly[1]);
  const month = Number(dateOnly[2]);
  const day = Number(dateOnly[3]);
  const parsed = new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
    ? parsed
    : null;
}

/**
 * Server mirror of the client signal date lens. Keep the key list and
 * properties-before-root precedence synchronized with signal-date-filter.ts.
 * graph_nodes has no created_at column on OVH, so the only server fallback is
 * props.publishedAt; createdAt is intentionally unavailable and treated as null.
 */
export function serverSignalEtapeDate(props: unknown): Date | null {
  const root = signalRecord(props);
  const nested = signalRecord(root.properties);
  for (const record of [nested, root]) {
    for (const key of SIGNAL_DATE_KEYS) {
      const value = record[key];
      if (typeof value === "string" && value.trim() !== "") return parseServerSignalDate(value);
    }
  }

  const publishedAt = root.publishedAt;
  return typeof publishedAt === "string" && publishedAt.trim() !== ""
    ? parseServerSignalDate(publishedAt)
    : null;
}

function isSignalInDateRange(props: unknown, range?: GraphSignalDateRange): boolean {
  if (!range?.dateFrom && !range?.dateTo) return true;

  const date = serverSignalEtapeDate(props);
  // A bounded window cannot place a row with no extractable, parseable date.
  if (!date) return false;

  const lower = range.dateFrom ? parseServerSignalBoundary(range.dateFrom, false) : null;
  const upper = range.dateTo ? parseServerSignalBoundary(range.dateTo, true) : null;
  return (!lower || date >= lower) && (!upper || date <= upper);
}

export interface CitySignalCounts {
  citySlug: string;
  signalCount: number;
  subsetCounts: Record<SubsetKey, number>;
  vivierV2Counts: ReturnType<typeof computeVivierV2>["counts"];
}

/** Aggregate one projection in both rails. Pure so A/B parity is testable. */
export function aggregateGraphSignalProjectionRows(
  rows: readonly GraphSignalProjectionRow[],
  dateRange?: GraphSignalDateRange,
): CitySignalCounts[] {
  function emptySubsetCounts(): Record<SubsetKey, number> {
    const out = {} as Record<SubsetKey, number>;
    for (const [z, m, p, r] of SUBSET_FLAG_COMBOS) out[buildSubsetKey(z, m, p, r)] = 0;
    return out;
  }

  const byCity = new Map<string, {
    signalCount: number;
    subsetCounts: Record<SubsetKey, number>;
    signals: VivierSignalInput[];
    legacySignals: VivierSignalInput[];
    bPrimeEligibleSignals: VivierSignalInput[];
  }>();

  for (const row of rows) {
    if (!row.citySlug) continue;
    if (!isSignalInDateRange(row.props, dateRange)) continue;
    if (!byCity.has(row.citySlug)) {
      byCity.set(row.citySlug, {
        signalCount: 0,
        subsetCounts: emptySubsetCounts(),
        signals: [],
        legacySignals: [],
        bPrimeEligibleSignals: [],
      });
    }
    const entry = byCity.get(row.citySlug)!;
    entry.signalCount += 1;
    const signal: VivierSignalInput = {
      id: row.id,
      type: row.type,
      category: row.category ?? null,
      label: row.label,
      description: row.description ?? null,
      etape: row.etapeAnnote ?? null,
      nbUnitesMax: row.nbUnitesMax ?? null,
      intensite: row.intensite ?? null,
      props: row.props,
      sourceRef: row.sourceRef,
    };
    entry.signals.push(signal);

    // Legacy A (z|m|p) is derived from the full projection. B′ only gates
    // the new residential axis `r`; it must not rewrite legacy membership.
    entry.legacySignals.push(extractLegacyZmpInput(row));
    const bPrimeEligible = classifyBPrime({
      category: row.category ?? null,
      label: row.label,
      description: row.description ?? null,
      etapeAnnotation: row.etapeAnnote ?? null,
      props: row.props as Record<string, unknown>,
      sourceRef: row.sourceRef,
    }).exclusionReason === null;
    if (bPrimeEligible) entry.bPrimeEligibleSignals.push(signal);
  }

  return Array.from(byCity.entries()).map(([citySlug, data]) => {
    const legacySubsetCounts = computeLegacySubsetCounts(data.legacySignals);
    for (const key of Object.keys(legacySubsetCounts) as Array<keyof typeof legacySubsetCounts>) {
      data.subsetCounts[key] = legacySubsetCounts[key];
    }

    // B-prime exclusions gate the active legacy subsets and r intersections;
    // vivier_v2 remains computed from the complete source projection below.
    for (const signal of data.bPrimeEligibleSignals) {
      const r = isResidentielPertinent(
        signal.category ?? signal.etape,
        signal.label ?? null,
        signal.description ?? null,
      );
      if (!r) continue;
      const z = isZonageSignal(signal.type, signal.category, signal.etape);
      const m = isMulti4Plus(signal.type, signal.nbUnitesMax, signal.intensite);
      const p = isPrecoceSignal(signal.etape, signal.label, signal.description);
      for (const [kZ, kM, kP, kR] of SUBSET_FLAG_COMBOS) {
        if (kR && (!kZ || z) && (!kM || m) && (!kP || p)) {
          data.subsetCounts[buildSubsetKey(kZ, kM, kP, true)] += 1;
        }
      }
    }

    const v2 = computeVivierV2(data.signals);
    return {
      citySlug,
      signalCount: data.signalCount,
      subsetCounts: data.subsetCounts,
      vivierV2Counts: v2.counts,
    };
  });
}

export async function listCitiesWithSignalNodes(
  db: Database,
  dateRange?: GraphSignalDateRange,
): Promise<CitySignalCounts[]> {
  // One row per individual signal node (no count grouping in SQL) so both
  // contracts are derived from the same source projection.
  const rows = await db
    .select({
      id: graphNodes.id,
      citySlug: graphNodes.citySlug,
      type: graphNodes.type,
      category: sql<string | null>`${graphNodes.props}->'properties'->>'category'`,
      label: graphNodes.label,
      nbUnitesMax: sql<string | null>`${graphNodes.props}->'properties'->>'nb_unites_max'`,
      intensite: sql<string | null>`${graphNodes.props}->'properties'->>'intensite'`,
      description: sql<string | null>`${graphNodes.props}->'properties'->>'description'`,
      etapeAnnote: sql<string | null>`${graphNodes.props}->'properties'->>'etape'`,
      props: graphNodes.props,
      sourceRef: graphNodes.sourceRef,
    })
    .from(graphNodes)
    .where(
      and(
        inArray(graphNodes.type, ["Signal", "DesignationEvent"]),
        isNotNull(graphNodes.citySlug),
      ),
    );

  return aggregateGraphSignalProjectionRows(rows, dateRange);
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
