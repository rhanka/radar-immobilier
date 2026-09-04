/**
 * WP A.3.x — Graph-signals read routes.
 *
 * Expose Signal and DesignationEvent nodes from graph_nodes as a T1 signal
 * feed — the REAL graphify pipeline (1 141 nodes / ~197 villes), NOT the old
 * ontology project-state (9 pilot cities only).
 *
 * GET /api/graph-signals/by-city
 *   Returns aggregate signal counts per city.
 *   Optional inclusive ISO-8601 query params: dateFrom/dateTo. A date-only
 *   dateTo includes the full local calendar day; no params means all-time.
 *   Response: { ok: true, totalCount, cities: [{ citySlug, signalCount, subsetCounts }] }
 *
 * GET /api/graph-signals/:city
 *   Returns Signal + DesignationEvent nodes for one city.
 *   Response: { ok: true, citySlug, nodes: [{ id, type, label, citySlug, sourceRef, createdAt, props }] }
 *   Returns 404 when no signal nodes exist for the city.
 */

import { Hono } from "hono";
import {
  classifyBPrime,
  readRegulatoryStatus,
  type BPrimeClassification,
  type RegulatoryStatusT,
  type RegulatoryStageKindT,
} from "@radar/domain";
import {
  classifyGraphNodeLegacyZmp,
  classifyGraphNodeVivierV2,
  buildLegacyZmpProjection,
  getSignalNodesForCity,
  getRaisesSignalLinks,
  listCitiesWithSignalNodes,
} from "../services/graph/graph-store.js";
import type { Database } from "../db/client.js";
import type { ObjectStore } from "../storage/object-store.js";
import {
  apiDocumentUrl,
  findDocumentMetadata,
  normalizeRawRef,
  type DocumentMetadata,
} from "../services/sources/document-resolver.js";

export interface GraphSignalsDeps {
  db: Database;
  store: ObjectStore;
  /**
   * Budget temps GLOBAL (ms) de l'enrichissement documentaire S3 pour UNE
   * requête per-city. Passé ce budget, les refs restantes sont dégradées
   * (servies sans métadonnée doc) au lieu de bloquer la réponse. Défaut :
   * `DOC_ENRICHMENT_BUDGET_MS`. Surtout utile aux tests.
   */
  docEnrichmentBudgetMs?: number;
}

export interface GraphSignalDocRef {
  docSha: string;
  excerpt?: string;
  page?: number;
  sourceUrl?: string;
  rawRef?: string;
  documentUrl?: string;
  title?: string;
  contentType?: string;
  fetchedAt?: string;
  publishedAt?: string;
  bbox?: unknown;
  /**
   * `true` quand le PV a été rattaché AUTOMATIQUEMENT par le filet Radar
   * (`linkSource === "radar-auto-link"`), à distinguer d'une citation graphify
   * vérifiée. Voir `linkSource` pour la provenance brute.
   */
  provisional?: boolean;
  /** Provenance du lien documentaire (ex. `"radar-auto-link"`). */
  linkSource?: string;
}

export interface GraphSignalCard {
  id: string;
  type: string;
  label: string;
  citySlug: string | null;
  sourceRef: string | null;
  createdAt: string | null;
  description: string | null;
  publishedAt: string | null;
  docRefs: GraphSignalDocRef[];
  evidence: SignalEvidence;
  classification: ReturnType<typeof classifyGraphNodeVivierV2>;
  legacySubset: ReturnType<typeof classifyGraphNodeLegacyZmp>;
  bPrime: BPrimeClassification;
  /** Étape de cycle de vie SERVIE verbatim (props.properties.etape) — matériau du
   *  re-drive hide-72 côté UI (vues A.4) et de l'agrégat PAR règlement/zone. */
  etape: string | null;
  /** Ferme vs anticipation SERVI (axe MARQUAGE, R5) : champ PERSISTÉ (A.2) LU tel
   *  quel, sinon fallback `deriveRegulatoryStatus` legacy — jamais re-classifié ici.
   *  N'est PAS le hide-72 (règle avis-only séparée re-drivée du `etape`). */
  regulatoryStatus: RegulatoryStatusT;
  props: Record<string, unknown>;
  /**
   * §7.6 cross-display — citation INHERITED from the DesignationEvent that
   * `raises_signal` → this signal (rezonage). The citation lives on the EVENT's
   * props, not the signal's, so the viewer would otherwise show "Citation
   * MANQUANT" on the signal. Kept as a DISTINCT field (never merged into
   * `evidence`) so the signal's OWN evidence/completeness stays unchanged and
   * provenance is explicit via `eventId`. OMITTED entirely when no linked event
   * carries a citation, so the frozen /api/graph-signals payload for signals
   * without an inherited citation is byte-for-byte unchanged (present ⇒ always a
   * non-null CitationFromEvent).
   */
  citationFromEvent?: CitationFromEvent;
}

/** Citation inherited from the linked DesignationEvent (§7.6, provenance-explicit). */
export interface CitationFromEvent {
  /** The DesignationEvent node id that raises this signal (provenance). */
  eventId: string;
  citation: string | null;
  excerpt: string | null;
  page: number | null;
  rawRef: string | null;
  docSha: string | null;
  documentUrl: string | null;
  sourceUrl: string | null;
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function firstStringValue(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function firstNumber(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

/**
 * Lit un drapeau booléen tolérant (true / "true" / 1) sur la 1re clé présente.
 * `undefined` si aucune clé n'est explicitement positionnée (l'absence n'est
 * PAS `false` : un PV non auto-lié laisse simplement le champ vide).
 */
function firstBoolean(
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
    if (typeof value === "string") {
      const trimmed = value.trim().toLowerCase();
      if (trimmed === "true" || trimmed === "1") return true;
      if (trimmed === "false" || trimmed === "0") return false;
    }
  }
  return undefined;
}

function nodeDescription(props: Record<string, unknown>): string | null {
  const topLevel = firstString(props, ["description", "summary", "details"]);
  if (topLevel) return topLevel;
  const nested = props.properties;
  if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
    return firstString(nested as Record<string, unknown>, ["description", "summary", "details"]);
  }
  return null;
}

function parseDocRefRecord(item: unknown, fallbackId: string): GraphSignalDocRef | null {
  if (typeof item !== "object" || item === null) return null;
  const r = item as Record<string, unknown>;
  const excerpt = firstString(r, ["excerpt", "citation", "quote", "text", "selection", "highlight"]);
  const sourceUrl = firstString(r, [
    "sourceUrl",
    "source_url",
    "pdfUrl",
    "pdf_url",
    "url",
    "href",
  ]);
  const documentUrl = firstString(r, ["documentUrl", "document_url", "apiUrl", "api_url"]);
  const rawRef = firstString(r, [
    "rawRef",
    "raw_ref",
    "file",
    "ref",
    "sourceRef",
    "source_ref",
    "path",
    "s3Key",
    "s3_key",
  ]);
  const docSha = firstString(r, [
    "docSha",
    "doc_sha",
    "sha",
    "sha256",
    "hash",
    "documentSha",
    "document_sha",
    "file",
    "ref",
    "sourceRef",
    "source_ref",
  ]);
  const page = firstNumber(r, ["page", "pageNumber", "page_number"]);
  const bbox = r.bbox ?? r.boundingBox ?? r.bounding_box;
  // Filet Radar : un PV auto-lié porte `provisional: true` + `linkSource`.
  const linkSource = firstString(r, ["linkSource", "link_source"]);
  const provisional =
    firstBoolean(r, ["provisional", "is_provisional", "isProvisional", "auto", "autoLinked"]) ??
    (linkSource === "radar-auto-link" ? true : undefined);

  if (!docSha && !excerpt && !sourceUrl && !rawRef && !documentUrl) return null;

  return {
    docSha: docSha ?? rawRef ?? sourceUrl ?? documentUrl ?? fallbackId,
    ...(excerpt !== null ? { excerpt } : {}),
    ...(page !== undefined ? { page } : {}),
    ...(sourceUrl !== null ? { sourceUrl } : {}),
    ...(rawRef !== null ? { rawRef } : {}),
    ...(documentUrl !== null ? { documentUrl } : {}),
    ...(bbox !== undefined ? { bbox } : {}),
    ...(provisional !== undefined ? { provisional } : {}),
    ...(linkSource !== null ? { linkSource } : {}),
  };
}

function extractDocRefs(
  props: Record<string, unknown>,
  sourceRef: string | null,
): GraphSignalDocRef[] {
  const result: GraphSignalDocRef[] = [];
  const rawRefs = props.refs;

  if (Array.isArray(rawRefs)) {
    rawRefs.forEach((item, index) => {
      const parsed = parseDocRefRecord(item, `ref-${index + 1}`);
      if (parsed) result.push(parsed);
    });
  }

  const topLevel = parseDocRefRecord(props, "citation");
  if (topLevel) result.push(topLevel);

  // Lit aussi le bloc imbriqué props.properties (structure « rimouski » : tout
  // le docSha/citation/rawRef vit dans properties, sans props.refs ni top-level).
  const nested = props.properties;
  if (isRecord(nested)) {
    if (Array.isArray(nested.refs)) {
      nested.refs.forEach((item, index) => {
        const parsed = parseDocRefRecord(item, `nested-ref-${index + 1}`);
        if (parsed) result.push(parsed);
      });
    }
    const nestedTop = parseDocRefRecord(nested, "nested-citation");
    if (nestedTop) result.push(nestedTop);
  }

  if (sourceRef && result.length === 0) {
    result.push({ docSha: sourceRef, rawRef: sourceRef });
  }

  const seen = new Set<string>();
  return result.filter((ref) => {
    const key = [
      ref.docSha,
      ref.page ?? "",
      ref.sourceUrl ?? "",
      ref.rawRef ?? "",
      ref.documentUrl ?? "",
      ref.excerpt ?? "",
    ].join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function applyMetadata(ref: GraphSignalDocRef, meta: DocumentMetadata | null): GraphSignalDocRef {
  if (!meta) {
    const normalizedRawRef = ref.rawRef ? normalizeRawRef(ref.rawRef) : null;
    return normalizedRawRef && !ref.sourceUrl
      ? { ...ref, rawRef: normalizedRawRef, documentUrl: apiDocumentUrl(normalizedRawRef) }
      : ref;
  }

  return {
    ...ref,
    docSha: meta.docSha,
    rawRef: meta.rawRef,
    sourceUrl: ref.sourceUrl ?? meta.sourceUrl,
    documentUrl: apiDocumentUrl(meta.rawRef),
    contentType: meta.contentType,
    fetchedAt: meta.fetchedAt,
    ...(meta.title !== undefined ? { title: meta.title } : {}),
    ...(meta.publishedAt !== undefined ? { publishedAt: meta.publishedAt } : {}),
  };
}

/** Budget temps GLOBAL par défaut (ms) de l'enrichissement doc d'UNE requête. */
export const DOC_ENRICHMENT_BUDGET_MS = 2_000;

/**
 * Contexte d'enrichissement documentaire partagé PAR REQUÊTE (et non par
 * nœud) — INCIDENT « l'API signal ne répond pas » :
 * - `cache` : UNE résolution S3 par (rawRef, docSha) pour toute la ville. Un
 *   cache par nœud relançait N résolutions parallèles du même document.
 * - `deadlineAt`/`exceeded` : budget temps GLOBAL. Passé le budget, les refs
 *   restantes sont dégradées (servies sans métadonnée doc) au lieu de bloquer
 *   la réponse — l'endpoint répond TOUJOURS, même si S3 rame ou pend.
 */
interface DocEnrichmentContext {
  readonly cache: Map<string, Promise<DocumentMetadata | null>>;
  readonly deadlineAt: number;
  exceeded: boolean;
}

function createDocEnrichmentContext(
  budgetMs: number = DOC_ENRICHMENT_BUDGET_MS,
): DocEnrichmentContext {
  return { cache: new Map(), deadlineAt: Date.now() + budgetMs, exceeded: false };
}

const DOC_ENRICHMENT_TIMEOUT: unique symbol = Symbol("doc-enrichment-timeout");

/**
 * Attend `promise` au plus jusqu'à la deadline du contexte. Deadline atteinte
 * → marque le budget dépassé et rend `null` (dégradation). La résolution
 * abandonnée continue en arrière-plan mais ne peut pas produire de rejet non
 * géré : son `catch` est attaché à la création (voir `enrichDocRefs`).
 */
async function awaitWithinBudget(
  promise: Promise<DocumentMetadata | null>,
  context: DocEnrichmentContext,
): Promise<DocumentMetadata | null> {
  const remainingMs = context.deadlineAt - Date.now();
  if (remainingMs <= 0) {
    context.exceeded = true;
    return null;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      promise,
      new Promise<typeof DOC_ENRICHMENT_TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(DOC_ENRICHMENT_TIMEOUT), remainingMs);
      }),
    ]);
    if (result === DOC_ENRICHMENT_TIMEOUT) {
      context.exceeded = true;
      return null;
    }
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Enrichit chaque doc-ref avec ses métadonnées d'object store (S3), de manière
 * RÉSILIENTE PAR DOC-REF : si `findDocumentMetadata` jette pour UNE ref (objet
 * S3 manquant, erreur réseau, ref malformée), on DÉGRADE cette ref seule via
 * `applyMetadata(ref, null)` (fallback rawRef→documentUrl) au lieu de faire
 * rejeter tout le `Promise.all` — ce qui remontait en 500 « Signaux
 * indisponibles » pour toute la ville. L'échec est journalisé côté serveur.
 *
 * Le cache ET le budget temps vivent dans `context`, partagé par TOUS les
 * nœuds d'une même requête (voir `DocEnrichmentContext`).
 */
async function enrichDocRefs(
  store: ObjectStore,
  refs: readonly GraphSignalDocRef[],
  context: DocEnrichmentContext,
  onError?: (ref: GraphSignalDocRef, error: unknown) => void,
): Promise<GraphSignalDocRef[]> {
  return Promise.all(
    refs.map(async (ref) => {
      if (context.exceeded || Date.now() >= context.deadlineAt) {
        context.exceeded = true;
        return applyMetadata(ref, null);
      }
      const key = `${ref.rawRef ?? ""}\u0000${ref.docSha}`;
      if (!context.cache.has(key)) {
        context.cache.set(
          key,
          findDocumentMetadata(store, {
            ...(ref.rawRef !== undefined ? { rawRef: ref.rawRef } : {}),
            docSha: ref.docSha,
          }).catch((error) => {
            onError?.(ref, error);
            // Dégradation best-effort : ref non enrichie (le fallback
            // rawRef→documentUrl reste appliqué), jamais un rejet propagé.
            return null;
          }),
        );
      }
      return applyMetadata(ref, await awaitWithinBudget(context.cache.get(key)!, context));
    }),
  );
}

/**
 * Construit la carte à partir de doc-refs DÉJÀ résolues (enrichies ou
 * dégradées). Fonction pure et synchrone : aucun accès store, donc ne jette
 * pas — elle sert aussi au repli par-nœud.
 */
function buildSignalCard(
  node: Awaited<ReturnType<typeof getSignalNodesForCity>>[number],
  docRefs: GraphSignalDocRef[],
): GraphSignalCard {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const firstPublishedAt =
    docRefs.find((ref) => ref.publishedAt !== undefined)?.publishedAt ?? null;
  const evidence = mergeEvidenceWithDocRefs(
    buildEvidence({
      props,
      sourceRef: node.sourceRef,
    }),
    docRefs,
    firstPublishedAt,
  );
  const properties = nestedProperties(props);
  const description = nodeDescription(props);
  const classification = classifyGraphNodeVivierV2({
    id: node.id,
    type: node.type,
    category: firstString(properties, ["category"]) ?? firstString(props, ["category"]),
    label: node.label,
    description,
    etapeAnnote: firstString(properties, ["etape"]) ?? firstString(props, ["etape"]),
    props,
    sourceRef: node.sourceRef,
  });
  const legacySubset = classifyGraphNodeLegacyZmp({
    id: node.id,
    type: node.type,
    label: node.label,
    props,
    sourceRef: node.sourceRef,
  });
  const bPrime = classifyBPrime({
    category: firstString(properties, ["category"]) ?? firstString(props, ["category"]),
    label: node.label,
    description,
    etapeAnnotation: firstStringValue(properties, ["etape"]) ?? firstStringValue(props, ["etape"]),
    props,
    sourceRef: node.sourceRef,
  });

  // R5 (A.3b) : surface etape + regulatoryStatus en champs 1re-classe (LU via le
  // locus unique readRegulatoryStatus : champ persisté A.2 sinon fallback legacy).
  const etape = firstString(properties, ["etape"]) ?? firstString(props, ["etape"]);
  const rawReg = firstString(properties, ["regulatoryStatus"]) ?? firstString(props, ["regulatoryStatus"]);
  const regulatoryStatus = readRegulatoryStatus({
    regulatoryStatus: rawReg === "firm" || rawReg === "anticipation" ? rawReg : null,
    statut: (firstString(properties, ["statut"]) ?? firstString(props, ["statut"])) as
      | RegulatoryStageKindT
      | null,
    etape,
  });

  return {
    id: node.id,
    type: node.type,
    label: node.label,
    citySlug: node.citySlug,
    sourceRef: node.sourceRef,
    createdAt: node.createdAt ? node.createdAt.toISOString() : null,
    description,
    publishedAt: firstPublishedAt,
    docRefs,
    evidence,
    classification,
    legacySubset,
    bPrime,
    etape,
    regulatoryStatus,
    props,
    // citationFromEvent is OMITTED here; the /:city route sets it ONLY when the
    // raises_signal join yields an inherited citation (§7.6) — so cards without
    // one keep the frozen payload shape.
  };
}

/**
 * Derive the CitationFromEvent field for a signal from the served evidence of
 * the DesignationEvent that raises it. Returns null when the event carries no
 * citation/excerpt (nothing to inherit) — the signal card then keeps its default
 * null. Pure: the event's evidence is already resolved by the same buildEvidence
 * path, so the inherited citation is, by construction, the one served on the
 * event (recette integrity: served == certified-on-event).
 */
export function citationFromEventEvidence(
  eventId: string,
  eventEvidence: SignalEvidence,
): CitationFromEvent | null {
  if (eventEvidence.citation === null && eventEvidence.excerpt === null) return null;
  return {
    eventId,
    citation: eventEvidence.citation,
    excerpt: eventEvidence.excerpt,
    page: eventEvidence.page,
    rawRef: eventEvidence.rawRef,
    docSha: eventEvidence.refs[0]?.docSha ?? null,
    documentUrl: eventEvidence.documentUrl,
    sourceUrl: eventEvidence.sourceUrl,
  };
}

async function toGraphSignalCard(
  store: ObjectStore,
  node: Awaited<ReturnType<typeof getSignalNodesForCity>>[number],
  context: DocEnrichmentContext,
  citySlug?: string,
): Promise<GraphSignalCard> {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const docRefs = await enrichDocRefs(
    store,
    extractDocRefs(props, node.sourceRef),
    context,
    (ref, error) => {
      console.error(
        `[graph-signals] doc-ref enrichment failed (city=${citySlug ?? node.citySlug ?? "?"} node=${node.id} ref=${ref.rawRef ?? ref.docSha}):`,
        error,
      );
    },
  );
  return buildSignalCard(node, docRefs);
}

/**
 * Repli PAR NŒUD : si la construction d'une carte échoue malgré la résilience
 * par doc-ref (cas non prévu), on renvoie quand même la carte sans enrichissement
 * S3 plutôt que de faire tomber toute la ville. Aucun accès store.
 */
function toDegradedSignalCard(
  node: Awaited<ReturnType<typeof getSignalNodesForCity>>[number],
): GraphSignalCard {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const docRefs = extractDocRefs(props, node.sourceRef).map((ref) =>
    applyMetadata(ref, null),
  );
  return buildSignalCard(node, docRefs);
}

export type EvidenceMissingField =
  | "description"
  | "citation"
  | "pdfLink"
  | "documentDate"
  | "page"
  | "bbox";

export interface EvidenceCompleteness {
  hasDescription: boolean;
  hasCitationExcerpt: boolean;
  hasPdfLink: boolean;
  hasDocumentDate: boolean;
  hasPage: boolean;
  hasBbox: boolean;
  missing: EvidenceMissingField[];
}

export interface SignalEvidenceRef {
  docSha: string | null;
  citation: string | null;
  excerpt: string | null;
  sourceUrl: string | null;
  documentUrl: string | null;
  rawRef: string | null;
  rawObjectKey: string | null;
  page: number | null;
  bbox: [number, number, number, number] | null;
  /** PV rattaché automatiquement par le filet Radar (à confirmer). */
  provisional: boolean;
  /** Provenance brute du lien (ex. `"radar-auto-link"`), `null` si inconnue. */
  linkSource: string | null;
}

export interface SignalEvidence {
  description: string | null;
  citation: string | null;
  excerpt: string | null;
  sourceUrl: string | null;
  documentUrl: string | null;
  rawRef: string | null;
  rawObjectKey: string | null;
  sourceRef: string | null;
  documentDate: string | null;
  page: number | null;
  bbox: [number, number, number, number] | null;
  /**
   * `true` quand la preuve provient d'un rattachement AUTOMATIQUE du filet
   * Radar (`linkSource === "radar-auto-link"`) plutôt que d'une citation
   * graphify vérifiée. Pilote l'affichage du badge « source liée
   * automatiquement » côté UI.
   */
  provisional: boolean;
  /** Provenance brute du lien documentaire, `null` si inconnue. */
  linkSource: string | null;
  refs: SignalEvidenceRef[];
  completeness: EvidenceCompleteness;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBbox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const numbers = value.map(readNumber);
  return numbers.every((n): n is number => n !== null)
    ? [numbers[0]!, numbers[1]!, numbers[2]!, numbers[3]!]
    : null;
}

function firstEvidenceString(values: readonly unknown[]): string | null {
  for (const value of values) {
    const str = readString(value);
    if (str) return str;
  }
  return null;
}

function firstEvidenceNumber(values: readonly unknown[]): number | null {
  for (const value of values) {
    const number = readNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function firstEvidenceBbox(values: readonly unknown[]): [number, number, number, number] | null {
  for (const value of values) {
    const bbox = readBbox(value);
    if (bbox) return bbox;
  }
  return null;
}

function nestedProperties(props: Record<string, unknown>): Record<string, unknown> {
  return isRecord(props.properties) ? props.properties : {};
}

function isUrlLike(value: string | null): boolean {
  return value !== null && /^(?:https?:)?\/\//u.test(value);
}

function extractEvidenceRefs(props: Record<string, unknown>): SignalEvidenceRef[] {
  const raw = props.refs;
  if (!Array.isArray(raw)) return [];

  const refs: SignalEvidenceRef[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const rawRef = readString(item);
      if (rawRef) {
        refs.push({
          docSha: null,
          citation: null,
          excerpt: null,
          sourceUrl: isUrlLike(rawRef) ? rawRef : null,
          documentUrl: isUrlLike(rawRef) ? rawRef : null,
          rawRef: isUrlLike(rawRef) ? null : rawRef,
          rawObjectKey: null,
          page: null,
          bbox: null,
          provisional: false,
          linkSource: null,
        });
      }
      continue;
    }
    if (!isRecord(item)) continue;

    const sourceUrl = firstEvidenceString([item.sourceUrl, item.url]);
    const documentUrl = firstEvidenceString([item.documentUrl, sourceUrl]);
    const rawRef = firstEvidenceString([item.rawRef, item.ref]);
    const rawObjectKey = firstEvidenceString([
      item.rawObjectKey,
      item.storageKey,
      item.casKey,
    ]);
    const excerpt = firstEvidenceString([item.excerpt, item.citation]);
    const citation = firstEvidenceString([item.citation, excerpt]);
    // Filet Radar : un PV auto-lié porte `provisional: true` + `linkSource`.
    const linkSource = firstEvidenceString([item.linkSource, item.link_source]);
    const provisional =
      firstBoolean(item, [
        "provisional",
        "is_provisional",
        "isProvisional",
        "auto",
        "autoLinked",
      ]) ?? linkSource === "radar-auto-link";
    const ref: SignalEvidenceRef = {
      docSha: firstEvidenceString([item.docSha, item.sha256]),
      citation,
      excerpt,
      sourceUrl,
      documentUrl,
      rawRef,
      rawObjectKey,
      page: firstEvidenceNumber([item.page]),
      bbox: firstEvidenceBbox([item.bbox]),
      provisional,
      linkSource,
    };

    if (
      ref.docSha ||
      ref.citation ||
      ref.excerpt ||
      ref.sourceUrl ||
      ref.documentUrl ||
      ref.rawRef ||
      ref.rawObjectKey ||
      ref.page !== null ||
      ref.bbox ||
      ref.provisional ||
      ref.linkSource
    ) {
      refs.push(ref);
    }
  }
  return refs;
}

function buildCompleteness(evidence: Omit<SignalEvidence, "completeness">): EvidenceCompleteness {
  const completeness: EvidenceCompleteness = {
    hasDescription: evidence.description !== null,
    hasCitationExcerpt: evidence.citation !== null || evidence.excerpt !== null,
    hasPdfLink:
      evidence.sourceUrl !== null ||
      evidence.documentUrl !== null ||
      evidence.rawRef !== null ||
      evidence.rawObjectKey !== null ||
      evidence.sourceRef !== null,
    hasDocumentDate: evidence.documentDate !== null,
    hasPage: evidence.page !== null,
    hasBbox: evidence.bbox !== null,
    missing: [],
  };

  if (!completeness.hasDescription) completeness.missing.push("description");
  if (!completeness.hasCitationExcerpt) completeness.missing.push("citation");
  if (!completeness.hasPdfLink) completeness.missing.push("pdfLink");
  if (!completeness.hasDocumentDate) completeness.missing.push("documentDate");
  if (!completeness.hasPage) completeness.missing.push("page");
  if (!completeness.hasBbox) completeness.missing.push("bbox");

  return completeness;
}

function buildEvidence(input: {
  props: Record<string, unknown>;
  sourceRef: string | null;
}): SignalEvidence {
  const { props, sourceRef } = input;
  const properties = nestedProperties(props);
  const refs = extractEvidenceRefs(props);
  const firstRef = refs[0];
  const sourceRefString = readString(sourceRef);

  const sourceUrl = firstEvidenceString([
    firstRef?.sourceUrl,
    firstRef?.documentUrl,
    props.sourceUrl,
    properties.sourceUrl,
    props.url,
    properties.url,
    isUrlLike(sourceRefString) ? sourceRefString : null,
  ]);
  const documentUrl = firstEvidenceString([
    firstRef?.documentUrl,
    sourceUrl,
    props.documentUrl,
    properties.documentUrl,
  ]);
  const rawRef = firstEvidenceString([
    firstRef?.rawRef,
    props.rawRef,
    properties.rawRef,
    !isUrlLike(sourceRefString) ? sourceRefString : null,
  ]);

  const evidenceWithoutCompleteness: Omit<SignalEvidence, "completeness"> = {
    description: firstEvidenceString([
      props.description,
      properties.description,
      props.summary,
      properties.summary,
      props.resume,
      properties.resume,
      props.justification,
      properties.justification,
    ]),
    citation: firstEvidenceString([
      firstRef?.citation,
      firstRef?.excerpt,
      props.citation,
      properties.citation,
      props.excerpt,
      properties.excerpt,
    ]),
    excerpt: firstEvidenceString([
      firstRef?.excerpt,
      firstRef?.citation,
      props.excerpt,
      properties.excerpt,
      props.citation,
      properties.citation,
    ]),
    sourceUrl,
    documentUrl,
    rawRef,
    rawObjectKey: firstEvidenceString([
      firstRef?.rawObjectKey,
      props.rawObjectKey,
      properties.rawObjectKey,
      props.storageKey,
      properties.storageKey,
      props.casKey,
      properties.casKey,
    ]),
    sourceRef: sourceRefString,
    documentDate: firstEvidenceString([
      props.documentDate,
      properties.documentDate,
      props.date,
      properties.date,
      props.publishedAt,
      properties.publishedAt,
      props.meetingDate,
      properties.meetingDate,
      props.etapeDate,
      properties.etapeDate,
      props.etape_date,
      properties.etape_date,
    ]),
    page: firstEvidenceNumber([firstRef?.page, props.page, properties.page]),
    bbox: firstEvidenceBbox([firstRef?.bbox, props.bbox, properties.bbox]),
    // Filet Radar : auto-liaison provisoire (node-level OU top-level OU nested).
    linkSource:
      firstRef?.linkSource ??
      firstEvidenceString([props.linkSource, properties.linkSource, props.link_source, properties.link_source]),
    provisional:
      (firstRef?.provisional ?? false) ||
      (firstBoolean(props, ["provisional", "is_provisional", "isProvisional"]) ?? false) ||
      (firstBoolean(properties, ["provisional", "is_provisional", "isProvisional"]) ?? false) ||
      firstEvidenceString([props.linkSource, properties.linkSource, props.link_source, properties.link_source]) ===
        "radar-auto-link",
    refs,
  };

  return {
    ...evidenceWithoutCompleteness,
    completeness: buildCompleteness(evidenceWithoutCompleteness),
  };
}

function evidenceRefFromDocRef(ref: GraphSignalDocRef): SignalEvidenceRef {
  return {
    docSha: ref.docSha,
    citation: ref.excerpt ?? null,
    excerpt: ref.excerpt ?? null,
    sourceUrl: ref.sourceUrl ?? null,
    documentUrl: ref.documentUrl ?? ref.sourceUrl ?? null,
    rawRef: ref.rawRef ?? null,
    rawObjectKey: null,
    page: ref.page ?? null,
    bbox: readBbox(ref.bbox),
    provisional: ref.provisional ?? ref.linkSource === "radar-auto-link",
    linkSource: ref.linkSource ?? null,
  };
}

function mergeEvidenceWithDocRefs(
  evidence: SignalEvidence,
  docRefs: readonly GraphSignalDocRef[],
  firstPublishedAt: string | null,
): SignalEvidence {
  const firstRef = docRefs[0];
  const refs = evidence.refs.length > 0 ? evidence.refs : docRefs.map(evidenceRefFromDocRef);
  const merged: Omit<SignalEvidence, "completeness"> = {
    ...evidence,
    citation: evidence.citation ?? firstRef?.excerpt ?? null,
    excerpt: evidence.excerpt ?? firstRef?.excerpt ?? null,
    sourceUrl: evidence.sourceUrl ?? firstRef?.sourceUrl ?? null,
    documentUrl: evidence.documentUrl ?? firstRef?.documentUrl ?? firstRef?.sourceUrl ?? null,
    rawRef: firstRef?.rawRef ?? evidence.rawRef ?? null,
    documentDate: evidence.documentDate ?? firstRef?.publishedAt ?? firstPublishedAt,
    page: evidence.page ?? firstRef?.page ?? null,
    bbox: evidence.bbox ?? readBbox(firstRef?.bbox),
    // Filet Radar : on retient l'auto-liaison si elle est présente côté node-level
    // (evidence) OU sur le docRef enrichi (firstRef).
    provisional:
      evidence.provisional || (firstRef?.provisional ?? firstRef?.linkSource === "radar-auto-link"),
    linkSource: evidence.linkSource ?? firstRef?.linkSource ?? null,
    refs,
  };
  return {
    ...merged,
    completeness: buildCompleteness(merged),
  };
}

export function graphSignalsRoute(deps: GraphSignalsDeps): Hono {
  const app = new Hono();

  // GET /api/graph-signals/by-city
  app.get("/api/graph-signals/by-city", async (c) => {
    const dateFrom = c.req.query("dateFrom")?.trim() || undefined;
    const dateTo = c.req.query("dateTo")?.trim() || undefined;
    const dateRange = dateFrom || dateTo
      ? {
          ...(dateFrom ? { dateFrom } : {}),
          ...(dateTo ? { dateTo } : {}),
        }
      : undefined;
    const cities = dateRange
      ? await listCitiesWithSignalNodes(deps.db, dateRange)
      : await listCitiesWithSignalNodes(deps.db);
    const totalCount = cities.reduce((sum, city) => sum + city.signalCount, 0);
    return c.json({ ok: true, totalCount, cities });
  });

  // GET /api/graph-signals/:city
  app.get("/api/graph-signals/:city", async (c) => {
    const city = c.req.param("city");
    // Un échec ici (DB down) est non-récupérable → 5xx légitime. L'enrichissement
    // documentaire, lui, est best-effort et NE DOIT PAS produire de 5xx.
    const nodes = await getSignalNodesForCity(deps.db, city);
    if (nodes.length === 0) {
      return c.json({ ok: false, error: "no_signal_nodes", citySlug: city }, 404);
    }
    // Résilience PAR NŒUD : un nœud dont la construction échoue est dégradé
    // (carte sans enrichissement S3) plutôt que de faire tomber toute la ville.
    // Le contexte d'enrichissement (cache + budget temps) est PAR REQUÊTE :
    // tous les nœuds partagent les résolutions S3 et le même budget global.
    const enrichment = createDocEnrichmentContext(deps.docEnrichmentBudgetMs);
    const mapped = await Promise.all(
      nodes.map((n) =>
        toGraphSignalCard(deps.store, n, enrichment, city).catch((error) => {
          console.error(
            `[graph-signals] signal card build failed (city=${city} node=${n.id}):`,
            error,
          );
          return toDegradedSignalCard(n);
        }),
      ),
    );
    if (enrichment.exceeded) {
      console.warn(
        `[graph-signals] doc enrichment budget exceeded (city=${city}, nodes=${nodes.length}): responded with degraded doc refs`,
      );
    }

    // §7.6 cross-display — inherit each signal's citation from the
    // DesignationEvent that raises_signal → it (rezonage: the citation lives on
    // the event, but the served card is the signal). Distinct field, so the
    // signal's OWN evidence/completeness is untouched. Best-effort read-only edge
    // lookup: a failure degrades citationFromEvent to null, never a 5xx.
    try {
      const links = await getRaisesSignalLinks(deps.db, nodes.map((n) => n.id));
      if (links.length > 0) {
        const eventEvidenceById = new Map(
          mapped
            .filter((card) => card.type === "DesignationEvent")
            .map((card) => [card.id, card.evidence] as const),
        );
        const eventBySignal = new Map(links.map((l) => [l.signalId, l.eventId]));
        for (const card of mapped) {
          const eventId = eventBySignal.get(card.id);
          if (eventId === undefined) continue;
          const eventEvidence = eventEvidenceById.get(eventId);
          if (!eventEvidence) continue;
          const inherited = citationFromEventEvidence(eventId, eventEvidence);
          if (inherited) card.citationFromEvent = inherited;
        }
      }
    } catch (error) {
      console.warn(
        `[graph-signals] raises_signal citation inherit failed (city=${city}):`,
        error,
      );
    }

    const legacyProjection = buildLegacyZmpProjection(
      mapped.map((node) => node.legacySubset),
    );
    return c.json({ ok: true, citySlug: city, legacyProjection, nodes: mapped });
  });

  return app;
}
