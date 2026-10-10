/**
 * WP A.3.1 — Graph store service.
 *
 * Persists graphify graph.json output (nodes + links) into the Postgres
 * `graph_nodes` / `graph_edges` tables. Node ids are unique inside ONE city
 * only (GH #812), so every key carries the city. All writes are idempotent:
 *   - nodes   → INSERT … ON CONFLICT (city_slug, id) DO UPDATE SET (label, type, props)
 *   - edges   → INSERT … ON CONFLICT (city_slug, src_id, dst_id, kind) DO UPDATE SET props
 * Every writer takes the per-city advisory lock first (`lockCityGraph`).
 *
 * Read helpers cover the two main access patterns:
 *   - `queryNeighbors(city, nodeId)` → all edges incident on a node + their endpoints
 *   - `subgraphForCity(citySlug)` → all nodes + edges for a city scope
 *   - `subgraphForMrc(mrc)`       → merged subgraph for all cities in an MRC
 *   - `listMrcs(db)`              → MRC list with ingested node counts
 */

import { z } from "zod";
import { eq, or, sql, inArray, notInArray, and, isNotNull } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { graphNodes, graphEdges } from "../../db/schema.js";
import { QC_MUNICIPALITIES } from "@radar/sources";
import { classifyBPrime, deriveRegulatoryStatus, isHiddenByVivierBExclusions, matchesDocumentDateWindow, type DocumentDateWindow, type RegulatoryStageKindT } from "@radar/domain";
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
   * graphify v1 (old) emits `file_type`; graphify v2 emits `type`.
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
     * graphify v1 (old) emits `relation`; graphify v2 emits `type` on
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

/** Served-surface node types whose per-event source lived on the `derived_from` edge (dropped by
 * the pre-materialization projection → phantom). */
const SEVERED_SOURCE_TYPES = new Set(["Signal", "DesignationEvent"]);

function refDocShas(refs: unknown): string[] {
  if (!Array.isArray(refs)) return [];
  const out: string[] = [];
  for (const r of refs) {
    if (r && typeof r === "object") {
      const d = (r as Record<string, unknown>).docSha;
      if (typeof d === "string" && d.length > 0) out.push(d);
    }
  }
  return out;
}

/** A node already carries a servable source iff sourceRef, a source-bearing prop, or a
 * docSha-bearing props.refs entry is present (mirrors graph-signals hasPdfLink inputs). */
function nodeRowHasSource(row: NodeRow): boolean {
  if (row.sourceRef) return true;
  const p = row.props as Record<string, unknown>;
  if (refDocShas(p.refs).length > 0) return true;
  const pp = (p.properties ?? {}) as Record<string, unknown>;
  for (const k of ["sourceUrl", "source_url", "rawRef", "docSha", "source_storage_key", "sourceRef"]) {
    const v = pp[k];
    if (typeof v === "string" && v.length > 0) return true;
  }
  return refDocShas(pp.refs).length > 0;
}

const MATERIALIZE_LINK_SOURCE = "projection-materialize-severed";
const RAISES_SIGNAL_KIND = "raises_signal";
/** Edges whose refs[0] carries the served node's own source locator. */
const EVENT_SOURCE_KINDS = new Set(["derived_from", "supports"]);

/** The edge kind (v1 `relation` wins, else v2 `type`), mirroring buildEdgeRow. */
function edgeKind(l: GraphifyLink): string | undefined {
  return l.relation ?? l.type;
}

/**
 * The first usable source locator an edge asserts on refs[0]: a real docSha
 * (never a `generated://` placeholder) with its 1-based page (null when the ref
 * carries no valid page — the caller then skips WITH a reason, never fabricates).
 */
function firstEdgeSourceRef(refs: unknown): { docSha: string; page: number | null } | null {
  if (!Array.isArray(refs)) return null;
  for (const r of refs) {
    if (!r || typeof r !== "object" || Array.isArray(r)) continue;
    const rec = r as Record<string, unknown>;
    const docSha = rec.docSha;
    if (typeof docSha !== "string" || docSha.length === 0) continue;
    const rawRef = rec.rawRef;
    if (typeof rawRef === "string" && rawRef.startsWith("generated://")) continue;
    const page =
      typeof rec.page === "number" && Number.isInteger(rec.page) && rec.page >= 1 ? rec.page : null;
    return { docSha, page };
  }
  return null;
}

/**
 * CLOSED-ENUMERATION outcome of the severed-source materialization (§521-ét gates
 * b/c/d): every raised Signal is accounted for exactly once —
 * `raisedSignals === alreadySourced + materialized + skipped.{no_event_source +
 * locator_without_page + evidence_absent + other}`. Emitted even at zero so
 * "ran, nothing to do" is distinguishable from "step never ran".
 */
export interface SourceMaterializationResult {
  /** Denominator: served Signals that are the target of ≥1 raises_signal edge. */
  raisedSignals: number;
  /** Denominator: raised Signals whose raising event carries a source docSha. */
  withSourcedEvent: number;
  /** Raised Signals already carrying their own source (idempotent skip). */
  alreadySourced: number;
  /** Raised Signals given a CONFORMING ref (docSha+page+evidence → validateCitedSourceRef ok). */
  materialized: number;
  /** Why a raised Signal was NOT materialized (closed set). */
  skipped: {
    no_event_source: number;
    locator_without_page: number;
    evidence_absent: number;
    other: number;
  };
}

/**
 * Re-materialize the severed per-event source onto served Signal|DesignationEvent
 * nodes as a CONFORMING cited-source ref (`docSha` + `rawRef` + `page` +
 * evidence-text `excerpt`) so the shared viewer's `validateCitedSourceRef` accepts
 * it (locator≥1 AND page AND evidence≥1) — a locator-only ref is rejected and the
 * node stays a phantom that the viewer never renders (the owner bug).
 *
 * Source mapping (measured on the docs-pocs baseline, extraction):
 *  - a DesignationEvent's source lives on ITS OWN edges — `derived_from`
 *    (event→bylaw) or `supports` (source→event), refs[0] = {docSha, page:1};
 *    evidence = the event's own `label`.
 *  - a Signal's source is INHERITED from the event that `raises_signal → it` (that
 *    edge is EMPTY at baseline): the raising event's docSha+page, and the raising
 *    event's `label` as evidence-text.
 *
 * `page:1` is the honest generic seance-document page (baseline), NOT invented —
 * the grounding refines it to the exact resolution page + verbatim excerpt
 * (additive). NEVER fabricates: a missing docSha or page → the node is skipped
 * WITH a reason (closed enumeration), never a made-up locator. Idempotent: a node
 * already carrying a source is left untouched.
 */
export function materializeSeveredSources(
  nodeRows: NodeRow[],
  links: GraphifyLink[],
  _rawNodes: GraphifyNode[],
): SourceMaterializationResult {
  // Each node's own source locator (from its derived_from/supports edges) + the
  // signal→raising-event map (raises_signal edges).
  const eventSource = new Map<string, { docSha: string; page: number | null }>();
  const raisingEventBySignal = new Map<string, string>();
  for (const l of links) {
    const kind = edgeKind(l);
    if (kind === RAISES_SIGNAL_KIND) {
      raisingEventBySignal.set(l.target, l.source);
      continue;
    }
    if (!kind || !EVENT_SOURCE_KINDS.has(kind)) continue;
    const ref = firstEdgeSourceRef((l as { refs?: unknown }).refs);
    if (!ref) continue;
    // derived_from: the EVENT is the source endpoint; supports: the event is the target.
    const eventId = kind === "supports" ? l.target : l.source;
    if (!eventSource.has(eventId)) eventSource.set(eventId, ref);
  }

  const labelById = new Map<string, string>();
  for (const row of nodeRows) {
    if (typeof row.label === "string" && row.label.trim().length > 0) {
      labelById.set(row.id, row.label.trim());
    }
  }

  const result: SourceMaterializationResult = {
    raisedSignals: 0,
    withSourcedEvent: 0,
    alreadySourced: 0,
    materialized: 0,
    skipped: { no_event_source: 0, locator_without_page: 0, evidence_absent: 0, other: 0 },
  };

  for (const row of nodeRows) {
    if (!SEVERED_SOURCE_TYPES.has(row.type)) continue;

    // Resolve the (source, evidence-text) this served node should carry.
    let src: { docSha: string; page: number | null } | undefined;
    let excerpt: string | undefined;
    let isRaisedSignal = false;
    if (row.type === "Signal" && raisingEventBySignal.has(row.id)) {
      isRaisedSignal = true;
      const eventId = raisingEventBySignal.get(row.id)!;
      src = eventSource.get(eventId);
      excerpt = labelById.get(eventId);
    } else if (row.type === "DesignationEvent") {
      src = eventSource.get(row.id);
      excerpt = labelById.get(row.id);
    } else {
      continue; // a Signal not raised by an event: outside the severed-source scope
    }

    if (isRaisedSignal) {
      result.raisedSignals++;
      if (src?.docSha) result.withSourcedEvent++;
    }
    if (nodeRowHasSource(row)) {
      if (isRaisedSignal) result.alreadySourced++;
      continue;
    }
    if (!src || !src.docSha) {
      if (isRaisedSignal) result.skipped.no_event_source++;
      continue;
    }
    if (src.page === null) {
      if (isRaisedSignal) result.skipped.locator_without_page++;
      continue; // never fabricate a page
    }
    const evidence = typeof excerpt === "string" && excerpt.trim().length > 0 ? excerpt.trim() : null;
    if (!evidence) {
      if (isRaisedSignal) result.skipped.evidence_absent++;
      continue;
    }

    // CONFORMING ref — matches the validated ok=true template exactly.
    const city = row.citySlug ?? "";
    const conformingRef = {
      docSha: src.docSha,
      rawRef: `raw/proces-verbaux-${city}/cas/${src.docSha}.pdf`,
      page: src.page,
      excerpt: evidence,
      linkSource: MATERIALIZE_LINK_SOURCE,
    };
    row.sourceRef = row.sourceRef ?? src.docSha;
    const existing = Array.isArray(row.props.refs) ? row.props.refs : [];
    row.props.refs = mergeRefs(existing, [conformingRef]);
    if (isRaisedSignal) result.materialized++;
  }

  return result;
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
  nodeRows: ReadonlyArray<{ type: string; props: Record<string, unknown> }>,
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
  /**
   * GH #817 — declared losses: node id → business keys whose disappearance is
   * accepted on that node only (validated against the plan by checkDeclaredChanges).
   * Every other key of the node, and every other node, stays guarded.
   */
  acceptedPropertyLosses: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
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
    const accepted = acceptedPropertyLosses.get(beforeRow.id);
    const missingKeys = Object.keys(before)
      .filter((key) => hasBusinessProperty(before, key) && !hasBusinessProperty(after, key))
      .filter((key) => !accepted?.has(key))
      .sort();
    if (missingKeys.length > 0) {
      regressions.push({ citySlug, nodeId: beforeRow.id, missingKeys });
    }
  }

  return regressions;
}

export interface SourceRefRegression {
  citySlug: string;
  nodeId: string;
  missingDocShas: string[];
}

/**
 * A `generated://` rawRef marks a synthetic `gen_refs` placeholder (not a real
 * PV) — excluded from provenance (Q3, spec §5).
 */
const GENERATED_REF_PREFIX = "generated://";

/**
 * Recover the source docSha embedded in a CAS raw-ref path
 * (`raw/proces-verbaux-<city>/cas/<docSha>.pdf` → `<docSha>`). Used ONLY to fill
 * the docSha when the ref's own `docSha` field is empty — never as an alternative
 * identity key.
 */
function docShaFromRawRef(rawRef: string): string | null {
  const m = rawRef.match(/\/cas\/([^/]+)\.[^/.]+$/);
  return m ? m[1]! : null;
}

/**
 * The set of REAL source docShas a node asserts under `props.refs`.
 *
 * Identity = **`docSha` alone** (SHA-256 of the source PV, content-stable) — NOT
 * `(docSha, page)`: `page` is an intra-doc refinement the grounding legitimately
 * upgrades (generic page-1 → precise page-10) for the SAME document, so keying on
 * page would false-positive (spec §5, Q1). `rawRef` is read ONLY to recover a
 * missing docSha from the CAS path. Refs whose `rawRef` is a `generated://`
 * placeholder are excluded (Q3).
 */
function nodeDocShas(props: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  const refs = props.refs;
  if (!Array.isArray(refs)) return out;
  for (const item of refs) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const r = item as Record<string, unknown>;
    const rawRef = typeof r.rawRef === "string" ? r.rawRef : null;
    if (rawRef && rawRef.startsWith(GENERATED_REF_PREFIX)) continue;
    let sha = typeof r.docSha === "string" && r.docSha.length > 0 ? r.docSha : null;
    if (!sha && rawRef) sha = docShaFromRawRef(rawRef);
    if (sha) out.add(sha);
  }
  return out;
}

/**
 * gate3 — find the source docShas that a node carried BEFORE and that the
 * candidate would DROP (per-node, match by id). A REPLACE projection rewrites
 * `props.refs` per node; neither gate1 (business-properties) nor gate2
 * (completeness COUNT) protects the IDENTITY of a node's source provenance, so a
 * candidate that overwrites/omits a node's own PV docSha passes silently. This
 * catches it: a docSha present before and absent after = provenance regression.
 *
 * Node-level and generic (every node bearing `props.refs`, like gate1). ADDITIONS
 * are allowed (candidate may add refs — grounding enrichment) — only DISAPPEARANCE
 * of an existing docSha is a regression. `intendedRemovals` exempts intentional
 * removals per-node, as gate1.
 */
export function findMissingSourceRefs(
  beforeRows: readonly BusinessPropertySnapshotRow[],
  afterRows: readonly BusinessPropertySnapshotRow[],
  citySlug: string,
  intendedRemovals: ReadonlySet<string> = new Set(),
): SourceRefRegression[] {
  const afterById = new Map(afterRows.map((row) => [row.id, row]));
  const regressions: SourceRefRegression[] = [];

  for (const beforeRow of beforeRows) {
    if (intendedRemovals.has(beforeRow.id)) continue;
    const before = nodeDocShas(beforeRow.props);
    if (before.size === 0) continue;
    const after = nodeDocShas(afterById.get(beforeRow.id)?.props ?? {});
    const missingDocShas = [...before].filter((sha) => !after.has(sha)).sort();
    if (missingDocShas.length > 0) {
      regressions.push({ citySlug, nodeId: beforeRow.id, missingDocShas });
    }
  }

  return regressions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The write surface shared by a Drizzle database handle and a Drizzle transaction.
 * Every graph writer runs its city work on a transaction (`DbTx`).
 */
export type DbTx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type GraphReader = Pick<Database, "select">;

/**
 * K9 (spec §4) — per-city writer lock. Every graph writer (`upsertGraph`,
 * `upsertGraphAtomic`, the city-key repair) takes it FIRST in its city
 * transaction, then reads its guard baseline, evaluates the guards and writes,
 * so no writer can slip between another writer's guard read and its write.
 * Transaction-scoped (released at commit/rollback) and re-entrant in a session.
 */
export async function lockCityGraph(tx: Pick<Database, "execute">, citySlug: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`graph-city:${citySlug}`}))`);
}

/** A city graph turned into DB rows: what one projection writes. Pure. */
export interface CityProjection {
  citySlug: string;
  nodeRows: NodeRow[];
  edgeRows: EdgeRow[];
  severedSource: SourceMaterializationResult;
}

/**
 * Turn a graphify `latest.json` into the rows a projection of `citySlug` writes:
 * schema parse, node/edge row builders, duplicate collapse and the severed-source
 * materialization. Pure, shared by the projection (`upsertGraphAtomic`) and the
 * city-key repair, so a repair preview simulates exactly what the projection does.
 */
export function prepareCityProjection(citySlug: string, graphJson: unknown): CityProjection {
  const parsed = graphifyGraphSchema.parse(graphJson);
  const links = [...(parsed.links ?? []), ...(parsed.edges ?? [])];
  const nodeRows = mergeNodeRows(parsed.nodes.map((n) => buildNodeRow(n, citySlug)));
  const edgeRows = mergeEdgeRows(links.map(buildEdgeRow));
  // Re-materialize the per-event source the projection would otherwise sever onto served nodes as
  // a CONFORMING cited-source ref (docSha+page+evidence) → hasPdfLink stays true, phantoms cannot
  // recur, and the ref passes validateCitedSourceRef.
  const severedSource = materializeSeveredSources(nodeRows, links, parsed.nodes);
  return { citySlug, nodeRows, edgeRows, severedSource };
}

/** Key of an edge inside one city graph. */
export function edgeKey(edge: { srcId: string; dstId: string; kind: string }): string {
  return `${edge.srcId}\u0000${edge.dstId}\u0000${edge.kind}`;
}

export type ProjectionGuardVerdict =
  | { verdict: "pass" }
  | { verdict: "refused"; gate: "gate1-business-property" | "gate3-source-ref" | "gate2-completeness"; reason: string };

/**
 * Gates 1 and 3 of the projection, pure: business properties and source docShas
 * present on the baseline rows must survive in the candidate rows. Gate 2
 * (completeness count) is evaluated by the writer on the projected state.
 */
export function evaluateRowGuards(
  citySlug: string,
  baselineRows: readonly BusinessPropertySnapshotRow[],
  candidateRows: readonly BusinessPropertySnapshotRow[],
  intendedRemovals: ReadonlySet<string> = new Set(),
  acceptedPropertyLosses: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): ProjectionGuardVerdict {
  const propertyRegressions = findMissingBusinessProperties(
    baselineRows,
    candidateRows,
    citySlug,
    intendedRemovals,
    acceptedPropertyLosses,
  );
  if (propertyRegressions.length > 0) {
    const details = propertyRegressions
      .map(({ nodeId, missingKeys }) => `${nodeId}: ${missingKeys.join(", ")}`)
      .join("; ");
    return {
      verdict: "refused",
      gate: "gate1-business-property",
      reason:
        `business-property regression for ${citySlug}: ` +
        `existing values would disappear or degrade (${details}); projection refused`,
    };
  }
  // gate3 — SOURCE-REF PROVENANCE : REPLACE réécrit props.refs par-nœud ; ni gate1
  // (business-props) ni gate2 (complétude COUNT) ne protègent l'IDENTITÉ de la
  // provenance source (docSha du PV). Un candidat qui écrase/omet le docSha propre
  // d'un nœud existant passerait silencieusement → provenance perdue. On refuse.
  const sourceRefRegressions = findMissingSourceRefs(baselineRows, candidateRows, citySlug, intendedRemovals);
  if (sourceRefRegressions.length > 0) {
    const details = sourceRefRegressions
      .map(({ nodeId, missingDocShas }) => `${nodeId}: ${missingDocShas.join(", ")}`)
      .join("; ");
    return {
      verdict: "refused",
      gate: "gate3-source-ref",
      reason:
        `source-ref provenance regression for ${citySlug}: ` +
        `existing source docSha(s) would disappear (${details}); projection refused`,
    };
  }
  return { verdict: "pass" };
}

/**
 * GH #817 (spec SPEC_FIX_GRAPH_CITY_KEY §17) — changes an operator DECLARES for one
 * city projection: node ids to delete, and business properties to drop from nodes the
 * candidate keeps. Nothing else may be removed or lost.
 */
export interface DeclaredChanges {
  /** Node ids the projection must delete: current rows of the city absent from the candidate. */
  removals: ReadonlySet<string>;
  /** Node id → `props.properties` keys the projection may drop from that node (kept by the candidate). */
  propertyLosses: ReadonlyMap<string, ReadonlySet<string>>;
}

/** The projection plan read against the declarations. Every list is sorted. */
export interface DeclaredChangesReport {
  /** Current rows of the city absent from the candidate (what the projection deletes). */
  plannedRemovals: string[];
  /** `id:key` business properties of rows kept by the candidate that would disappear (gate1 view). */
  plannedLosses: string[];
  /** `remove:<id>` / `lose:<id>:<key>` declared but not in the plan. Non-empty ⇒ the city is refused. */
  declaredNotInPlan: string[];
  /** Planned removals not declared. Non-empty ⇒ the city is refused. */
  undeclaredRemovals: string[];
}

/** Read the projection plan against the declared changes. Pure. */
export function checkDeclaredChanges(
  currentRows: readonly BusinessPropertySnapshotRow[],
  candidateRows: readonly BusinessPropertySnapshotRow[],
  declared: DeclaredChanges,
): DeclaredChangesReport {
  const candidateIds = new Set(candidateRows.map((row) => row.id));
  const plannedRemovals = currentRows.filter((row) => !candidateIds.has(row.id)).map((row) => row.id).sort();
  const removalSet = new Set(plannedRemovals);
  const keptRows = currentRows.filter((row) => candidateIds.has(row.id));
  const plannedLosses = findMissingBusinessProperties(keptRows, candidateRows, "")
    .flatMap(({ nodeId, missingKeys }) => missingKeys.map((key) => `${nodeId}:${key}`))
    .sort();
  const lossSet = new Set(plannedLosses);

  const declaredNotInPlan = [
    ...[...declared.removals].filter((id) => !removalSet.has(id)).map((id) => `remove:${id}`),
    ...[...declared.propertyLosses].flatMap(([id, keys]) =>
      [...keys].filter((key) => !lossSet.has(`${id}:${key}`)).map((key) => `lose:${id}:${key}`),
    ),
  ].sort();
  const undeclaredRemovals = plannedRemovals.filter((id) => !declared.removals.has(id));
  return { plannedRemovals, plannedLosses, declaredNotInPlan, undeclaredRemovals };
}

/**
 * All three guards of a projection evaluated without a database: gates 1 and 3 on
 * the rows, gate 2 on the completeness count (the projected state of the city is
 * exactly `candidateRows`). Used for the repair's "before" verdicts.
 */
export function evaluateProjectionGuards(
  citySlug: string,
  baselineRows: ReadonlyArray<BusinessPropertySnapshotRow & { type: string }>,
  candidateRows: ReadonlyArray<BusinessPropertySnapshotRow & { type: string }>,
): ProjectionGuardVerdict {
  const rowVerdict = evaluateRowGuards(citySlug, baselineRows, candidateRows);
  if (rowVerdict.verdict === "refused") return rowVerdict;
  const completeBefore = countCompleteSignals(baselineRows, { ignoreProvisional: true });
  const completeAfter = countCompleteSignals(candidateRows, { ignoreProvisional: true });
  if (completeAfter < completeBefore) {
    return {
      verdict: "refused",
      gate: "gate2-completeness",
      reason: `régression de preuves pour ${citySlug} : signaux complets ${completeBefore} → ${completeAfter}`,
    };
  }
  return { verdict: "pass" };
}

export interface UpsertResult {
  /** Nodes in the incoming graph (after id dedup). */
  nodeCount: number;
  edgeCount: number;
}

/**
 * Ingest a city-scoped graphify graph.json into Postgres (idempotent).
 *
 * Nodes are upserted by `(city_slug, id)`, edges by `(city_slug, src_id, dst_id,
 * kind)` (GH #812: ids are unique inside one city only). One transaction under
 * the per-city lock (K9). Re-running with the same graph.json is safe and
 * produces no duplicate rows. Never deletes (that is `upsertGraphAtomic`'s job).
 *
 * @param db       Drizzle database handle
 * @param citySlug City whose graph this is (every node and edge is written under it)
 * @param graphJson Raw parsed object (validated via graphifyGraphSchema)
 */
export async function upsertGraph(
  db: Database,
  citySlug: string,
  graphJson: unknown,
): Promise<UpsertResult> {
  const parsed = graphifyGraphSchema.parse(graphJson);
  const links = [...(parsed.links ?? []), ...(parsed.edges ?? [])];

  const nodeRows = mergeNodeRows(parsed.nodes.map((n) => buildNodeRow(n, citySlug)));
  const edgeRows = mergeEdgeRows(links.map(buildEdgeRow));

  await db.transaction(async (tx) => {
    await lockCityGraph(tx, citySlug);
    if (nodeRows.length > 0) {
      await tx
        .insert(graphNodes)
        .values(
          nodeRows.map((r) => ({
            id: r.id,
            type: r.type,
            label: r.label,
            citySlug,
            props: r.props,
            sourceRef: r.sourceRef,
          })),
        )
        .onConflictDoUpdate({
          target: [graphNodes.citySlug, graphNodes.id],
          set: {
            label: sql`excluded.label`,
            type: sql`excluded.type`,
            // Citation-safety — the worker-live FRESHNESS path (exploitation.ts →
            // this PURE upsert) has NONE of upsertGraphAtomic's gates (gate3 /
            // materializeSeveredSources / completeness). A wholesale
            // `props = excluded.props` would DROP an existing node's provenance refs
            // (e.g. the projection-materialized citations) when a fresh re-detection
            // re-emits the same node id with fewer/no refs. Instead: take the fresh
            // detection's props but keep `props.refs` NON-REGRESSING — union
            // existing ∪ incoming, deduped. When the existing node has no refs,
            // behave exactly as before (take excluded.props verbatim). Legitimate ref
            // removal remains the projection path's job (upsertGraphAtomic + gate3
            // intendedRemovals), never this freshness upsert.
            props: sql`
              CASE
                WHEN coalesce(${graphNodes.props} -> 'refs', '[]'::jsonb) = '[]'::jsonb
                  THEN excluded.props
                ELSE jsonb_set(
                  excluded.props,
                  '{refs}',
                  (
                    SELECT coalesce(jsonb_agg(DISTINCT e), '[]'::jsonb)
                    FROM jsonb_array_elements(
                      (${graphNodes.props} -> 'refs')
                        || coalesce(excluded.props -> 'refs', '[]'::jsonb)
                    ) AS e
                  )
                )
              END
            `,
            sourceRef: sql`excluded.source_ref`,
          },
        });
    }
    await upsertEdgeRows(tx, citySlug, edgeRows);
  });

  return { nodeCount: nodeRows.length, edgeCount: edgeRows.length };
}

/** Upsert the edges of one city on `(city_slug, src_id, dst_id, kind)`. */
async function upsertEdgeRows(tx: DbTx, citySlug: string, edgeRows: readonly EdgeRow[]): Promise<void> {
  if (edgeRows.length === 0) return;
  await tx
    .insert(graphEdges)
    .values(
      edgeRows.map((r) => ({
        citySlug,
        srcId: r.srcId,
        dstId: r.dstId,
        kind: r.kind,
        props: r.props,
      })),
    )
    .onConflictDoUpdate({
      target: [graphEdges.citySlug, graphEdges.srcId, graphEdges.dstId, graphEdges.kind],
      set: { props: sql`excluded.props` },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Projection atomique par ville (anti preuves-fantômes + gate de complétude)
// ─────────────────────────────────────────────────────────────────────────────

export interface UpsertAtomicResult {
  /** Nombre de nœuds projetés (présents dans le nouveau graphe). */
  nodeCount: number;
  /** Nombre d'arêtes projetées. */
  edgeCount: number;
  /** Nombre de nœuds orphelins supprimés (disparus du nouveau graphe). */
  deletedNodes: number;
  /** Nombre d'arêtes pendantes supprimées (référençant un nœud supprimé). */
  deletedEdges: number;
  /** Arêtes de la ville absentes du nouveau graphe, supprimées (K7). */
  deletedStaleEdges: number;
  /** true si la ville a été abortée (rollback) suite à une régression de preuves. */
  aborted: boolean;
  /** Message d'alerte loggable quand aborted=true. */
  reason?: string;
  /** GH #817 — the plan read against the declared changes (declared mode only). */
  declared?: DeclaredChangesReport;
  /**
   * GH #817 — declared mode, guards passed: the current PG rows of the declared nodes and
   * the city edges the projection deletes, read before any write (rollback material).
   */
  declaredBaseline?: {
    nodes: Array<{ id: string; type: string; label: string; props: unknown; sourceRef: string | null }>;
    edges: Array<{ srcId: string; dstId: string; kind: string; props: unknown }>;
  };
  /** GH #817 — true when the projection ran in preview: every write was rolled back. */
  preview?: boolean;
}

/** Erreur sentinelle servant à rollbacker la transaction d'une ville régressée. */
export class GraphCompletenessAbort extends Error {
  constructor(readonly result: UpsertAtomicResult) {
    super(result.reason);
    this.name = "GraphCompletenessAbort";
  }
}

export interface ProjectCityOptions {
  /**
   * Node ids this projection deletes ON PURPOSE (removal-only tools such as
   * purge-avis-bylaws). They are exempt from the business-property and
   * source-ref guards — their disappearance is intended, not a silent data loss.
   */
  intendedRemovals?: ReadonlySet<string>;
  /**
   * Node ids of the city's CURRENT rows left out of the guard baseline: the
   * city-key repair passes the rows proven to carry another city's content
   * (spec K10/K11). Every other current row stays guarded. Default: none.
   */
  baselineExcludeIds?: ReadonlySet<string>;
  /**
   * GH #817 (spec §17) — declared mode: the projection deletes exactly
   * `declared.removals` and may drop exactly `declared.propertyLosses`. A declaration
   * absent from the plan, or a planned removal not declared, refuses the city before
   * any write; gates 1, 2 and 3 run as usual with only the declared items exempt.
   * Exclusive with `intendedRemovals`.
   */
  declared?: DeclaredChanges;
}

const DELETE_CHUNK = 5000;

/**
 * The body of a city projection, inside the caller's transaction: per-city lock,
 * guard baseline read AFTER the lock (K9), gates 1 and 3, upserts, city-scoped
 * deletions (orphan nodes, their dangling edges, edges absent from the new graph),
 * then gate 2 (completeness) on the projected state.
 *
 * Returns `{ aborted: true }` WITHOUT writing when gate 1 or 3 refuses. Throws
 * `GraphCompletenessAbort` when gate 2 refuses, so the caller's transaction rolls
 * back every write of the city.
 */
export async function projectCityInTransaction(
  tx: DbTx,
  projection: CityProjection,
  options: ProjectCityOptions = {},
): Promise<UpsertAtomicResult> {
  const { citySlug, nodeRows, edgeRows } = projection;
  const declared = options.declared;
  if (declared && options.intendedRemovals && options.intendedRemovals.size > 0) {
    throw new Error("projectCityInTransaction: `declared` and `intendedRemovals` are exclusive");
  }
  const intendedRemovals = declared?.removals ?? options.intendedRemovals ?? new Set<string>();
  const acceptedPropertyLosses = declared?.propertyLosses ?? new Map<string, ReadonlySet<string>>();
  const baselineExclude = options.baselineExcludeIds ?? new Set<string>();
  const result: UpsertAtomicResult = {
    nodeCount: nodeRows.length,
    edgeCount: edgeRows.length,
    deletedNodes: 0,
    deletedEdges: 0,
    deletedStaleEdges: 0,
    aborted: false,
  };

  await lockCityGraph(tx, citySlug);

  // Guard baseline: the city's current PG rows, read under the lock.
  const currentRows = await tx
    .select({ id: graphNodes.id, type: graphNodes.type, props: graphNodes.props })
    .from(graphNodes)
    .where(eq(graphNodes.citySlug, citySlug));
  const baselineRows = currentRows
    .filter((row) => !baselineExclude.has(row.id))
    .map((row) => ({ id: row.id, type: row.type, props: (row.props ?? {}) as Record<string, unknown> }));
  const completeBefore = countCompleteSignals(baselineRows, { ignoreProvisional: true });

  // GH #817 — declared mode: every declaration must be in the plan BEFORE any exemption
  // applies (a declared removal of a node the candidate keeps would otherwise hide its loss).
  if (declared) {
    result.declared = checkDeclaredChanges(
      currentRows.map((row) => ({ id: row.id, props: (row.props ?? {}) as Record<string, unknown> })),
      nodeRows,
      declared,
    );
    if (result.declared.declaredNotInPlan.length > 0) {
      return {
        ...result,
        aborted: true,
        reason:
          `declared change(s) absent from the plan for ${citySlug}: ` +
          `${result.declared.declaredNotInPlan.join(", ")}; projection refused`,
      };
    }
  }

  const rowVerdict = evaluateRowGuards(citySlug, baselineRows, nodeRows, intendedRemovals, acceptedPropertyLosses);
  if (rowVerdict.verdict === "refused") {
    return { ...result, aborted: true, reason: rowVerdict.reason };
  }

  // Declared mode refuses EVERY other removal, including nodes without business property
  // or source ref that gates 1 and 3 do not see.
  if (result.declared && result.declared.undeclaredRemovals.length > 0) {
    return {
      ...result,
      aborted: true,
      reason:
        `undeclared removal(s) for ${citySlug}: ${result.declared.undeclaredRemovals.join(", ")}; projection refused`,
    };
  }

  // Declared mode: the PG rows the projection is about to delete or change, read before
  // any write, for the job log (rollback material). Explicit columns: `created_at` is
  // absent from the prod tables (drift, cf. 39-export-graph-nodes-job.yaml).
  if (declared) {
    const affectedIds = [...new Set([...declared.removals, ...declared.propertyLosses.keys()])];
    const nodes = affectedIds.length > 0
      ? await tx
          .select({ id: graphNodes.id, type: graphNodes.type, label: graphNodes.label, props: graphNodes.props, sourceRef: graphNodes.sourceRef })
          .from(graphNodes)
          .where(and(eq(graphNodes.citySlug, citySlug), inArray(graphNodes.id, affectedIds)))
      : [];
    const keptEdgeKeys = new Set(edgeRows.map(edgeKey));
    const edges = (
      await tx
        .select({ srcId: graphEdges.srcId, dstId: graphEdges.dstId, kind: graphEdges.kind, props: graphEdges.props })
        .from(graphEdges)
        .where(eq(graphEdges.citySlug, citySlug))
    ).filter((e) => !keptEdgeKeys.has(edgeKey(e)) || declared.removals.has(e.srcId) || declared.removals.has(e.dstId));
    result.declaredBaseline = { nodes, edges };
  }

  // 1. upsert nœuds sur (city_slug, id)
  if (nodeRows.length > 0) {
    await tx
      .insert(graphNodes)
      .values(
        nodeRows.map((r) => ({
          id: r.id,
          type: r.type,
          label: r.label,
          citySlug,
          props: r.props,
          sourceRef: r.sourceRef,
        })),
      )
      .onConflictDoUpdate({
        target: [graphNodes.citySlug, graphNodes.id],
        set: {
          label: sql`excluded.label`,
          type: sql`excluded.type`,
          props: sql`excluded.props`,
          sourceRef: sql`excluded.source_ref`,
        },
      });
  }

  // 2. upsert arêtes sur (city_slug, src_id, dst_id, kind)
  await upsertEdgeRows(tx, citySlug, edgeRows);

  // 3. SUPPRESSION des nœuds orphelins de CETTE ville, puis de leurs arêtes
  //    pendantes — toujours bornées à la ville (jamais une autre ville).
  const newNodeIds = nodeRows.map((r) => r.id);
  const orphanCond =
    newNodeIds.length > 0
      ? and(eq(graphNodes.citySlug, citySlug), notInArray(graphNodes.id, newNodeIds))
      : eq(graphNodes.citySlug, citySlug);
  const orphanIds = (await tx.select({ id: graphNodes.id }).from(graphNodes).where(orphanCond)).map((r) => r.id);

  if (orphanIds.length > 0) {
    const danglingEdges = await tx
      .delete(graphEdges)
      .where(
        and(
          eq(graphEdges.citySlug, citySlug),
          or(inArray(graphEdges.srcId, orphanIds), inArray(graphEdges.dstId, orphanIds)),
        ),
      )
      .returning({ id: graphEdges.id });
    result.deletedEdges = danglingEdges.length;

    const deleted = await tx
      .delete(graphNodes)
      .where(and(eq(graphNodes.citySlug, citySlug), inArray(graphNodes.id, orphanIds)))
      .returning({ id: graphNodes.id });
    result.deletedNodes = deleted.length;
  }

  // 4. SUPPRESSION des arêtes de la ville absentes du nouveau graphe (K7) : la
  //    projection réconcilie les arêtes comme les nœuds.
  const newEdgeKeys = new Set(edgeRows.map(edgeKey));
  const cityEdges = await tx
    .select({ id: graphEdges.id, srcId: graphEdges.srcId, dstId: graphEdges.dstId, kind: graphEdges.kind })
    .from(graphEdges)
    .where(eq(graphEdges.citySlug, citySlug));
  const staleEdgeIds = cityEdges.filter((e) => !newEdgeKeys.has(edgeKey(e))).map((e) => e.id);
  for (let i = 0; i < staleEdgeIds.length; i += DELETE_CHUNK) {
    const chunk = staleEdgeIds.slice(i, i + DELETE_CHUNK);
    const removed = await tx
      .delete(graphEdges)
      .where(and(eq(graphEdges.citySlug, citySlug), inArray(graphEdges.id, chunk)))
      .returning({ id: graphEdges.id });
    result.deletedStaleEdges += removed.length;
  }

  // 5. GATE DE COMPLÉTUDE : signaux complets APRÈS (état projeté, dans la
  //    transaction) comparés à AVANT (baseline lue sous le verrou).
  const afterSignalRows = await tx
    .select({ type: graphNodes.type, props: graphNodes.props })
    .from(graphNodes)
    .where(and(eq(graphNodes.citySlug, citySlug), inArray(graphNodes.type, ["Signal", "DesignationEvent"])));
  const completeAfter = countCompleteSignals(
    afterSignalRows.map((r) => ({ type: r.type, props: (r.props ?? {}) as Record<string, unknown> })),
    { ignoreProvisional: true },
  );
  if (completeAfter < completeBefore) {
    // Annule TOUTE la transaction de cette ville (upsert + suppressions).
    throw new GraphCompletenessAbort({
      ...result,
      deletedNodes: 0,
      deletedEdges: 0,
      deletedStaleEdges: 0,
      aborted: true,
      reason:
        `régression de preuves pour ${citySlug} : signaux complets ` +
        `${completeBefore} → ${completeAfter} (rollback, projection ignorée)`,
    });
  }

  return result;
}

/**
 * Projection ATOMIQUE d'un graphe city-scoped dans Postgres (tout-ou-rien).
 *
 * Contrairement à `upsertGraph` (upsert pur, conserve indéfiniment les nœuds
 * disparus → « preuves fantômes »), cette variante exécute dans UNE transaction
 * par ville, sous le verrou de la ville (K9) :
 *   1. GATE DE PROPRIÉTÉS MÉTIER et GATE DE PROVENANCE (docSha), évaluées sur
 *      l'état PG lu sous le verrou : refus avant toute écriture ;
 *   2. upsert des nœuds sur (city_slug, id) et des arêtes sur
 *      (city_slug, src_id, dst_id, kind) — GH #812 : un id n'est unique que dans
 *      une ville, une autre ville n'est jamais touchée ;
 *   3. SUPPRESSION des nœuds de cette ville ABSENTS du nouveau graphe, de leurs
 *      arêtes pendantes, et des arêtes de la ville absentes du nouveau graphe ;
 *   4. GATE DE COMPLÉTUDE : si le nombre de signaux « complets » APRÈS < AVANT,
 *      la transaction est ABORTÉE (rollback).
 *
 * La fonction NE throw PAS en cas d'abort (les autres villes doivent continuer) :
 * elle retourne `{ aborted: true, reason }`. Elle peut throw sur erreur DB
 * inattendue (laissée remonter à l'appelant pour comptage `errors`).
 *
 * @param db       Drizzle database handle
 * @param citySlug City whose graph this is
 * @param graphJson Objet brut (validé via graphifyGraphSchema)
 */
export async function upsertGraphAtomic(
  db: Database,
  citySlug: string,
  graphJson: unknown,
  /**
   * Node ids this projection deletes ON PURPOSE (removal-only tools such as
   * purge-avis-bylaws). They are exempt from the business-property-regression
   * guard — their disappearance is intended, not a silent data loss. Every
   * OTHER node stays guarded. Default empty = current strict behaviour.
   */
  intendedRemovals: ReadonlySet<string> = new Set(),
  /**
   * GH #817 (spec §17) — `declared`: declared mode (see `ProjectCityOptions.declared`);
   * `preview`: run the whole projection, guards included, then roll it back and return
   * its result with `preview: true`. Both absent = unchanged behaviour.
   */
  options: { declared?: DeclaredChanges; preview?: boolean } = {},
): Promise<UpsertAtomicResult> {
  const projection = prepareCityProjection(citySlug, graphJson);
  // §521-ét observability (gates b/c/d): emit the denominators + closed-enumeration shrinkage
  // counter UNCONDITIONALLY (even at zero) so "ran, 0 to do" ≠ "step never ran"; a high
  // `materialized` rate signals a graphify producer gap to fix upstream.
  const severedSource = projection.severedSource;
  console.info(
    `[graph-store] severed-source materialization ${citySlug}: ` +
      `raisedSignals=${severedSource.raisedSignals} withSourcedEvent=${severedSource.withSourcedEvent} ` +
      `alreadySourced=${severedSource.alreadySourced} materialized=${severedSource.materialized} ` +
      `skipped=${JSON.stringify(severedSource.skipped)}`,
  );

  const cityOptions: ProjectCityOptions = options.declared ? { intendedRemovals, declared: options.declared } : { intendedRemovals };
  try {
    return await db.transaction(async (tx) => {
      const result = await projectCityInTransaction(tx, projection, cityOptions);
      if (options.preview) throw new ProjectionPreviewRollback(result);
      return result;
    });
  } catch (err) {
    if (err instanceof GraphCompletenessAbort) {
      // Abort attendu : la transaction a été rollbackée, on retourne le résultat
      // marqué aborted sans propager (les autres villes continuent).
      return options.preview ? { ...err.result, preview: true } : err.result;
    }
    if (err instanceof ProjectionPreviewRollback) return { ...err.result, preview: true };
    throw err;
  }
}

/** Sentinel rolling back a preview projection (GH #817) once its result is known. */
class ProjectionPreviewRollback extends Error {
  constructor(readonly result: UpsertAtomicResult) {
    super("projection preview: rolled back");
    this.name = "ProjectionPreviewRollback";
  }
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
 * All edges of `citySlug` incident on node `(citySlug, nodeId)` (outgoing +
 * incoming), with the connected node record of the same city attached. Empty
 * array when the node has no edges. A node id alone is ambiguous across cities
 * (GH #812), so the city is required.
 *
 * Fix N+1 : les nœuds voisins sont chargés en une seule requête `inArray`
 * plutôt qu'un SELECT par arête.
 */
export async function queryNeighbors(
  db: GraphReader,
  citySlug: string,
  nodeId: string,
): Promise<Neighbor[]> {
  // Outgoing edges (nodeId → dst)
  const outEdges = await db
    .select()
    .from(graphEdges)
    .where(and(eq(graphEdges.citySlug, citySlug), eq(graphEdges.srcId, nodeId)));

  // Incoming edges (src → nodeId)
  const inEdges = await db
    .select()
    .from(graphEdges)
    .where(and(eq(graphEdges.citySlug, citySlug), eq(graphEdges.dstId, nodeId)));

  // Collect all neighbour ids to fetch in a single round-trip.
  const neighbourIds = [
    ...outEdges.map((e) => e.dstId),
    ...inEdges.map((e) => e.srcId),
  ];

  if (neighbourIds.length === 0) return [];

  // Single query for all neighbour nodes of the same city.
  const neighbourNodes = await db
    .select()
    .from(graphNodes)
    .where(and(eq(graphNodes.citySlug, citySlug), inArray(graphNodes.id, neighbourIds)));

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
 * Return all nodes of `citySlug` plus the edges of that city whose BOTH
 * endpoints are nodes of the city.
 */
export async function subgraphForCity(
  db: GraphReader,
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

  const cityEdges = await db
    .select({
      id: graphEdges.id,
      citySlug: graphEdges.citySlug,
      srcId: graphEdges.srcId,
      dstId: graphEdges.dstId,
      kind: graphEdges.kind,
      props: graphEdges.props,
    })
    .from(graphEdges)
    .where(eq(graphEdges.citySlug, citySlug));

  const edges = cityEdges.filter((e) => nodeIds.has(e.srcId) && nodeIds.has(e.dstId));

  return { citySlug, nodes, edges };
}

// ─────────────────────────────────────────────────────────────────────────────
// MRC-level aggregation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merged subgraph for all cities in an MRC.
 *
 * Queries QC_MUNICIPALITIES to resolve which city slugs belong to `mrc`, then
 * fetches all nodes + intra-city edges in a single pass. Two cities of the MRC
 * can hold the same node id: a node is identified by `(citySlug, id)` and every
 * edge carries its `citySlug` (GH #812).
 */
export interface MrcSubgraph {
  mrc: string;
  citySlugs: string[];
  nodes: (typeof graphNodes.$inferSelect)[];
  edges: (typeof graphEdges.$inferSelect)[];
}

/** Key of a node across cities. */
export function cityNodeKey(citySlug: string, id: string): string {
  return `${citySlug}\u0000${id}`;
}

/**
 * Return all graph nodes whose citySlug belongs to `mrc`, plus the edges of
 * those cities whose BOTH endpoints are nodes of the edge's city.
 *
 * Returns empty nodes/edges (not an error) when no data has been ingested for
 * any city in the requested MRC.
 */
export async function subgraphForMrc(
  db: GraphReader,
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

  const nodeKeys = new Set(nodes.map((n) => cityNodeKey(n.citySlug, n.id)));

  const candidateEdges = await db
    .select()
    .from(graphEdges)
    .where(inArray(graphEdges.citySlug, citySlugs));

  // Keep only edges whose endpoints are both nodes of the edge's city.
  const edges = candidateEdges.filter(
    (e) => nodeKeys.has(cityNodeKey(e.citySlug, e.srcId)) && nodeKeys.has(cityNodeKey(e.citySlug, e.dstId)),
  );

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
  // §3-CRITICAL ordering (W2). An "avis de motion" appearing in the text is NOT
  // enough to classify a resolution as avis_motion: a combined "avis + dépôt du
  // projet" or an "adoption du (premier) projet" resolution IS at the projet
  // stage, and a recital may merely RECALL a past avis ("avis de motion a été
  // donné"). So (a) only an ACTIVE avis (not the past-tense recital) is the avis
  // act; (b) concrete ACT stages take precedence over a bare avis; (c) a bare
  // active avis CONSERVATIVELY stays avis_motion — never promoted to `adoption`
  // on the FUTURE reference "présenté pour adoption lors d'une séance
  // subséquente" (that promotion = the 026-508 avis-served-firm bug).
  const hasActiveAvis =
    (text.includes("avis de motion") || text.includes("avis d motion")) &&
    !text.includes("avis de motion a ete donne");

  // 1. second projet (tested before « projet » to avoid the collision).
  if (
    text.includes("second projet") ||
    text.includes("2e projet") ||
    text.includes("deuxieme projet")
  ) {
    return "second_projet";
  }
  // 2. premier projet / adoption-dépôt d'un projet → projet_reglement. The ACT of
  //    ADOPTING or DEPOSITING a projet (NOT the final règlement adoption, and NOT
  //    a pure avis's future "présenté pour adoption").
  if (
    text.includes("premier projet") ||
    text.includes("1er projet") ||
    text.includes("projet de reglement") ||
    text.includes("projet du reglement") ||
    text.includes("adoption du projet") ||
    text.includes("adopte le projet") ||
    text.includes("depot du projet") ||
    text.includes("depose le projet")
  ) {
    return "projet_reglement";
  }
  // 3. §3 CONSERVATIVE GUARD (BEFORE consultation/vigueur/adoption): once no
  //    concrete projet ACT above matched, an ACTIVE avis de motion STAYS
  //    avis_motion. An active avis is NEVER itself en-vigueur / à-consultation
  //    (mutually exclusive stages), so an INCIDENTAL "en vigueur" (e.g. « … le
  //    Règlement 0651 [actuellement] en vigueur » — the EXISTING règlement being
  //    modified) or a FUTURE "adoption"/"consultation" must NOT promote it to
  //    firm. Closes the last 026-508 residual path.
  if (hasActiveAvis) {
    return "avis_motion";
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
  // 6. adoption / adopté (the final règlement adoption — reached only when the
  //    resolution is NOT a pure active avis)
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

export interface GraphSignalDateRange extends DocumentDateWindow {
  excludePiia?: boolean;
  excludeDerogations?: boolean;
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
    if (!matchesDocumentDateWindow(row.props, dateRange)) continue;
    // B display exclusions only gate the B (vivier_v2) path, exactly like the
    // client detail; legacy A counts keep the full date-scoped projection.
    const hiddenInB = (dateRange?.excludePiia || dateRange?.excludeDerogations)
      ? isHiddenByVivierBExclusions({ label: row.label, description: row.description ?? null,
        props: (row.props ?? {}) as Record<string, unknown>,
        classification: classifyGraphNodeVivierV2({ ...row, category: row.category ?? null,
          description: row.description ?? null, etapeAnnote: row.etapeAnnote ?? null }) }, {
        piiaSansProjetResidentiel: dateRange.excludePiia === true,
        derogationsMineures: dateRange.excludeDerogations === true,
      })
      : false;
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
    if (!hiddenInB) entry.signals.push(signal);

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
