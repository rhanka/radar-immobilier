/**
 * Client for GET /api/graph-signals/:city
 *
 * Fetches Signal + DesignationEvent nodes for one city from graph_nodes
 * (graphify pipeline, ~197 villes), NOT the old ontology project-state.
 *
 * Anti-invention: returns 404 when no signal nodes exist for the city.
 */

import type { VivierV2 } from "@radar/domain";

import {
  fetchWithTimeout,
  RequestTimeoutError,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from "$lib/net/fetch-with-timeout.js";
import type { BPrimeClassification } from "@radar/domain";
// Normalisation d'appariement zone PARTAGÉE (même langage de comparaison que le
// join signal↔zone et lot↔zone). Import de VALEUR ; l'arête inverse
// (signaux-map-geo → ce module) est `import type` uniquement (effacée au
// runtime), donc AUCUN cycle d'import réel.
import { zoneRefComparableKey } from "$lib/maps/signaux-map-geo.js";

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

/**
 * A documentary reference attached to a Signal or DesignationEvent node.
 *
 * Mirrors graphify `refs` items but keeps absence explicit. Older graph
 * snapshots may have a raw ref or citation without `docSha`; those are still
 * surfaced instead of being silently dropped.
 */
export interface SignalDocRef {
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
   * vérifiée.
   */
  provisional?: boolean;
  /** Provenance brute du lien documentaire (ex. `"radar-auto-link"`). */
  linkSource?: string;
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
   * automatiquement ». Absent/`false` = lien vérifié → pas de badge.
   */
  provisional: boolean;
  /** Provenance brute du lien documentaire, `null` si inconnue. */
  linkSource: string | null;
  refs: SignalDocRef[];
  completeness: EvidenceCompleteness;
}

function normalizeRawRef(rawRef: string): string | null {
  const trimmed = rawRef.trim();
  const rawIndex = trimmed.indexOf("raw/");
  const normalized = rawIndex >= 0 ? trimmed.slice(rawIndex) : trimmed;
  return normalized.startsWith("raw/") &&
    !normalized.endsWith(".meta.json") &&
    !normalized.includes("..") &&
    !normalized.includes("\0")
    ? normalized
    : null;
}

function rawDocumentUrl(rawRef: string): string | null {
  const normalized = normalizeRawRef(rawRef);
  if (!normalized) return null;
  // Préfixe VITE_API_BASE_URL comme TOUS les autres clients API du repo : sans
  // ça, l'URL `/api/...` relative ne fonctionne que same-origin (proxy dev /
  // prod nginx) et casse dès que l'UI et l'API sont sur des origines distinctes.
  const baseUrl = import.meta.env.VITE_API_BASE_URL;
  const path = `/api/documents/raw?rawRef=${encodeURIComponent(normalized)}`;
  return baseUrl ? `${baseUrl.replace(/\/$/, "")}${path}` : path;
}

/**
 * Extract typed SignalDocRef[] from graphify props.
 *
 * Graphify versions have not used one stable evidence shape: some rows store
 * `docSha/sourceUrl/excerpt`, others store `file/ref/citation` or only top-level
 * citation fields. Keep every usable citation/PDF reference instead of dropping
 * it because one identifier key is missing.
 */
export function extractDocRefs(props: Record<string, unknown>): SignalDocRef[] {
  const result: SignalDocRef[] = [];
  const raw = props["refs"];

  if (Array.isArray(raw)) {
    raw.forEach((item, index) => {
      const ref = parseDocRefRecord(item, `ref-${index + 1}`);
      if (ref) result.push(ref);
    });
  }

  const topLevelRef = parseDocRefRecord(props, "citation");
  if (topLevelRef) result.push(topLevelRef);

  return dedupeRefs(result);
}

function parseDocRefRecord(item: unknown, fallbackId: string): SignalDocRef | null {
  if (typeof item !== "object" || item === null) return null;
  const r = item as Record<string, unknown>;
  const excerpt = firstString(r, [
    "excerpt",
    "citation",
    "quote",
    "text",
    "selection",
    "highlight",
  ]);
  const sourceUrl = firstString(r, [
    "sourceUrl",
    "source_url",
    "pdfUrl",
    "pdf_url",
    "url",
    "href",
  ]);
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
  const documentUrl = firstString(r, ["documentUrl", "document_url", "apiUrl", "api_url"]);
  const title = firstString(r, ["title", "documentTitle", "document_title"]);
  const contentType = firstString(r, ["contentType", "content_type", "mimeType", "mime_type"]);
  const fetchedAt = firstString(r, ["fetchedAt", "fetched_at"]);
  const publishedAt = firstString(r, [
    "publishedAt",
    "published_at",
    "documentDate",
    "document_date",
  ]);
  const bbox = r.bbox ?? r.boundingBox ?? r.bounding_box;
  // Filet Radar : un PV auto-lié porte `provisional: true` + `linkSource`.
  const linkSource = firstString(r, ["linkSource", "link_source"]);
  const provisional =
    firstBoolean(r, ["provisional", "is_provisional", "isProvisional", "auto", "autoLinked"]) ??
    (linkSource === "radar-auto-link" ? true : undefined);

  if (!docSha && !excerpt && !sourceUrl && !rawRef && !documentUrl) return null;

  const normalizedRawRef = rawRef !== null ? normalizeRawRef(rawRef) ?? rawRef : null;
  const resolvedDocumentUrl =
    documentUrl ?? (rawRef !== null && !sourceUrl ? rawDocumentUrl(rawRef) : null);

  return {
    docSha: docSha ?? rawRef ?? sourceUrl ?? documentUrl ?? fallbackId,
    ...(excerpt !== null ? { excerpt } : {}),
    ...(page !== null ? { page } : {}),
    ...(sourceUrl !== null ? { sourceUrl } : {}),
    ...(normalizedRawRef !== null ? { rawRef: normalizedRawRef } : {}),
    ...(resolvedDocumentUrl !== null ? { documentUrl: resolvedDocumentUrl } : {}),
    ...(title !== null ? { title } : {}),
    ...(contentType !== null ? { contentType } : {}),
    ...(fetchedAt !== null ? { fetchedAt } : {}),
    ...(publishedAt !== null ? { publishedAt } : {}),
    ...(bbox !== undefined ? { bbox } : {}),
    ...(provisional !== undefined ? { provisional } : {}),
    ...(linkSource !== null ? { linkSource } : {}),
  };
}

function firstString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function firstNumber(
  record: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

/**
 * Lit un drapeau booléen tolérant (true / "true" / 1) sur la 1re clé présente.
 * `undefined` si aucune clé n'est explicitement positionnée — l'absence n'est
 * PAS `false` (un PV non auto-lié laisse simplement le champ vide).
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

function dedupeRefs(refs: readonly SignalDocRef[]): SignalDocRef[] {
  const seen = new Set<string>();
  const result: SignalDocRef[] = [];
  for (const ref of refs) {
    const key = [
      ref.docSha,
      ref.page ?? "",
      ref.sourceUrl ?? "",
      ref.rawRef ?? "",
      ref.documentUrl ?? "",
      ref.excerpt ?? "",
    ].join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}

function evidenceString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function evidenceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function evidenceBbox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const numbers = value.map(evidenceNumber);
  return numbers.every((n): n is number => n !== null)
    ? [numbers[0]!, numbers[1]!, numbers[2]!, numbers[3]!]
    : null;
}

function firstEvidenceString(values: readonly unknown[]): string | null {
  for (const value of values) {
    const str = evidenceString(value);
    if (str) return str;
  }
  return null;
}

function firstEvidenceNumber(values: readonly unknown[]): number | null {
  for (const value of values) {
    const number = evidenceNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function firstEvidenceBbox(values: readonly unknown[]): [number, number, number, number] | null {
  for (const value of values) {
    const bbox = evidenceBbox(value);
    if (bbox) return bbox;
  }
  return null;
}

function evidenceProperties(props: Record<string, unknown>): Record<string, unknown> {
  const properties = props.properties;
  return typeof properties === "object" && properties !== null && !Array.isArray(properties)
    ? (properties as Record<string, unknown>)
    : {};
}

function isUrlLike(value: string | null): boolean {
  return value !== null && /^(?:https?:)?\/\//u.test(value);
}

function normalizeApiRefs(refs: readonly SignalDocRef[] | undefined): SignalDocRef[] {
  if (!Array.isArray(refs)) return [];
  const normalized: SignalDocRef[] = [];
  refs.forEach((ref, index) => {
    const item = parseDocRefRecord(ref, `api-ref-${index + 1}`);
    if (item) normalized.push(item);
  });
  return normalized;
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

export function extractSignalEvidence(node: GraphSignalNode): SignalEvidence {
  const props = node.props ?? {};
  const properties = evidenceProperties(props);
  const apiEvidence = node.evidence;
  const refs = normalizeApiRefs(apiEvidence?.refs);
  const nodeRefs = normalizeApiRefs(node.docRefs);
  const fallbackRefs = refs.length > 0 ? refs : nodeRefs.length > 0 ? nodeRefs : extractDocRefs(props);
  const firstRef = fallbackRefs[0];
  const sourceRef = evidenceString(apiEvidence?.sourceRef) ?? evidenceString(node.sourceRef);

  const sourceUrl = firstEvidenceString([
    apiEvidence?.sourceUrl,
    firstRef?.sourceUrl,
    firstRef?.documentUrl,
    props.sourceUrl,
    properties.sourceUrl,
    props.url,
    properties.url,
    isUrlLike(sourceRef) ? sourceRef : null,
  ]);
  const documentUrl = firstEvidenceString([
    apiEvidence?.documentUrl,
    firstRef?.documentUrl,
    props.documentUrl,
    properties.documentUrl,
    sourceUrl,
  ]);
  const rawRef = firstEvidenceString([
    apiEvidence?.rawRef,
    firstRef?.rawRef,
    props.rawRef,
    properties.rawRef,
    !isUrlLike(sourceRef) ? sourceRef : null,
  ]);

  // Filet Radar : provenance brute du lien (API node-level, ref, props/nested).
  const linkSource = firstEvidenceString([
    apiEvidence?.linkSource,
    firstRef?.linkSource,
    props.linkSource,
    properties.linkSource,
    props.link_source,
    properties.link_source,
  ]);
  // Auto-liaison provisoire : drapeau explicite (API/ref/props/nested) OU
  // `linkSource === "radar-auto-link"`. Absent partout → false (lien vérifié).
  const provisional =
    (apiEvidence?.provisional ?? false) ||
    (firstRef?.provisional ?? false) ||
    (firstBoolean(props, ["provisional", "is_provisional", "isProvisional"]) ?? false) ||
    (firstBoolean(properties, ["provisional", "is_provisional", "isProvisional"]) ?? false) ||
    linkSource === "radar-auto-link";

  const evidenceWithoutCompleteness: Omit<SignalEvidence, "completeness"> = {
    description: firstEvidenceString([
      apiEvidence?.description,
      node.description,
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
      apiEvidence?.citation,
      firstRef?.excerpt,
      props.citation,
      properties.citation,
      props.excerpt,
      properties.excerpt,
    ]),
    excerpt: firstEvidenceString([
      apiEvidence?.excerpt,
      firstRef?.excerpt,
      props.excerpt,
      properties.excerpt,
      props.citation,
      properties.citation,
    ]),
    sourceUrl,
    documentUrl,
    rawRef,
    rawObjectKey: firstEvidenceString([
      apiEvidence?.rawObjectKey,
      props.rawObjectKey,
      properties.rawObjectKey,
      props.storageKey,
      properties.storageKey,
      props.casKey,
      properties.casKey,
    ]),
    sourceRef,
    documentDate: firstEvidenceString([
      apiEvidence?.documentDate,
      node.publishedAt,
      firstRef?.publishedAt,
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
    page: firstEvidenceNumber([apiEvidence?.page, firstRef?.page, props.page, properties.page]),
    bbox: firstEvidenceBbox([apiEvidence?.bbox, firstRef?.bbox, props.bbox, properties.bbox]),
    provisional,
    linkSource,
    refs: fallbackRefs,
  };

  return {
    ...evidenceWithoutCompleteness,
    completeness: buildCompleteness(evidenceWithoutCompleteness),
  };
}

export interface GraphSignalNode {
  id: string;
  type: "Signal" | "DesignationEvent" | string;
  label: string;
  citySlug: string | null;
  sourceRef: string | null;
  createdAt: string | null;
  description?: string | null;
  publishedAt?: string | null;
  etape?: string | null;
  docRefs?: SignalDocRef[];
  bPrime?: BPrimeClassification;
  props: Record<string, unknown>;
  evidence?: SignalEvidence;
  /**
   * Classification `vivier_v2` posée PAR LE SERVEUR (même passe que
   * `vivierV2Counts` de /by-city). Source de vérité de la vue B : le client
   * la lit, ne la recalcule jamais.
   */
  classification?: VivierV2;
  legacySubset?: {
    version: "legacy-zmp-v1";
    signalId: string;
    flags: { z: boolean; m: boolean; p: boolean };
  };
}

export interface LegacyZmpProjection {
  version: "legacy-zmp-v1";
  a: { count: number; signalIds: string[] };
}

export interface GraphSignalDetailResponse {
  ok: boolean;
  citySlug: string;
  legacyProjection: LegacyZmpProjection | null;
  nodes: GraphSignalNode[];
}

export interface FetchGraphSignalDetailOptions {
  /**
   * Signal d'annulation externe (anti-course). Distinct du timeout interne :
   * un abort externe (changement de ville) relève une `AbortError` — la réponse
   * périmée est IGNORÉE par l'appelant, pas transformée en erreur affichée.
   */
  signal?: AbortSignal;
}

export async function fetchGraphSignalDetail(
  citySlug: string,
  baseUrl = "",
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  opts: FetchGraphSignalDetailOptions = {},
): Promise<GraphSignalDetailResponse> {
  try {
    const res = await fetchWithTimeout(
      `${baseUrl}/api/graph-signals/${encodeURIComponent(citySlug)}`,
      { signal: opts.signal, timeoutMs },
    );
    if (!res.ok) {
      // 404 = ville sans signaux dans la DB — état vide honnête
      if (res.status === 404) {
        return { ok: false, citySlug, legacyProjection: null, nodes: [] };
      }
      throw new Error(`graph-signals/${citySlug}: ${res.status}`);
    }
    return res.json();
  } catch (err) {
    // Timeout interne → message dédié (contrat historique). Un abort EXTERNE
    // (AbortError) est relevé tel quel pour que l'appelant ignore la réponse.
    if (err instanceof RequestTimeoutError) {
      throw new Error(`graph-signals/${citySlug}: timeout after ${timeoutMs}ms`);
    }
    throw err;
  }
}

// ── Règlements rattachables à une zone (sourcés du graphe-signal) ─────────────

/**
 * Règlement de zonage rattaché à une zone, dérivé du graphe-signal.
 *
 * - `numero`   : numéro de règlement affiché VERBATIM (ex. "756", "901-43").
 * - `url`      : source documentaire PUBLIQUE ouvrable en nouvel onglet (la
 *                `sourceUrl` du PV). `null` si le nœud n'expose pas d'URL
 *                publique. JAMAIS un lien d'archive `/api/documents/raw`.
 * - `millesime`: année du règlement quand le nœud l'expose, sinon `null`
 *                (aucune invention — pas de dérivation depuis le numéro).
 */
export interface ZoneReglement {
  numero: string;
  url: string | null;
  millesime: string | null;
}

/** Enregistrements de props exploitables d'un nœud (racine + `properties` imbriqué). */
function nodePropRecords(node: GraphSignalNode): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const props = node.props ?? {};
  records.push(props);
  const nested = props.properties;
  if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
    records.push(nested as Record<string, unknown>);
  }
  return records;
}

/** Premier numéro de règlement porté par le nœud (scalaire ou 1er d'un tableau), sinon null. */
function readNodeReglementNumber(node: GraphSignalNode): string | null {
  const keys = ["reglement_number", "reglementNumber", "reglement_numero", "bylaw"];
  for (const record of nodePropRecords(node)) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim().length > 0) return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string" && item.trim().length > 0) return item.trim();
          if (typeof item === "number" && Number.isFinite(item)) return String(item);
        }
      }
    }
  }
  return null;
}

/**
 * Codes de zone STRUCTURÉS portés par le nœud (`zone_ref`/`zoneRef`, scalaire ou
 * tableau). Anti-invention : on n'utilise QUE les champs structurés — jamais une
 * zone devinée du texte libre — pour rattacher un règlement à une zone.
 */
function readNodeStructuredZoneRefs(node: GraphSignalNode): string[] {
  const keys = ["zone_ref", "zoneRef", "zone_refs", "zones"];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown): void => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };
  for (const record of nodePropRecords(node)) {
    for (const key of keys) {
      const value = record[key];
      if (Array.isArray(value)) value.forEach(push);
      else push(value);
    }
  }
  return out;
}

/** Millésime (année) du règlement quand le nœud l'expose, sinon null. */
function readNodeReglementMillesime(node: GraphSignalNode): string | null {
  const keys = ["reglement_millesime", "reglementMillesime", "millesime"];
  for (const record of nodePropRecords(node)) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim().length > 0) return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
  }
  return null;
}

/** Date d'événement en epoch ms pour départager les collisions, ou -Infinity. */
function eventDateEpoch(dateStr: string | null): number {
  if (!dateStr) return -Infinity;
  const t = Date.parse(dateStr);
  return Number.isFinite(t) ? t : -Infinity;
}

/**
 * Extrait, du détail signal, les RÈGLEMENTS rattachables à une zone, indexés par
 * `zoneRefComparableKey(zone_ref)`.
 *
 * Mécanique (rattachement HONNÊTE, même-nœud) : un nœud `DesignationEvent` qui
 * porte à la fois un `reglement_number` ET un `zone_ref` structuré rattache ce
 * numéro (+ sa `sourceUrl` publique) à cette zone. Un nœud qui ne porte que l'un
 * des deux n'engendre AUCUN rattachement — on n'invente jamais de lien
 * zone↔règlement que le graphe ne co-localise pas sur le même nœud.
 *
 * Collision (plusieurs règlements pour une même zone) : on garde le plus RÉCENT
 * par date d'événement ; à égalité/absence de date, le dernier rencontré gagne
 * (ordre d'itération stable).
 *
 * URL : uniquement la `sourceUrl` PUBLIQUE du nœud (nouvel onglet) — jamais un
 * lien d'archive `/api/documents/raw` (qui renvoie 404 document_not_found).
 */
export function extractZoneReglements(
  nodes: readonly GraphSignalNode[],
): Map<string, ZoneReglement> {
  const byKey = new Map<string, ZoneReglement>();
  const whenByKey = new Map<string, number>();
  for (const node of nodes) {
    if (node.type !== "DesignationEvent") continue;
    const numero = readNodeReglementNumber(node);
    if (!numero) continue;
    const zoneRefs = readNodeStructuredZoneRefs(node);
    if (zoneRefs.length === 0) continue;
    const evidence = extractSignalEvidence(node);
    const url = evidence.sourceUrl; // PUBLIC uniquement (jamais rawRef/archive)
    const millesime = readNodeReglementMillesime(node);
    const when = eventDateEpoch(evidence.documentDate);
    for (const ref of zoneRefs) {
      const key = zoneRefComparableKey(ref);
      if (key.length === 0) continue;
      const prevWhen = whenByKey.get(key);
      if (prevWhen === undefined || when >= prevWhen) {
        byKey.set(key, { numero, url, millesime });
        whenByKey.set(key, when);
      }
    }
  }
  return byKey;
}
