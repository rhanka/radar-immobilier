/**
 * J1.2d/e wagon 4 — `signals.coherent-city.v1` (§5.5): the per-city coherent
 * projection served to an artifact reader through the named reader op (no
 * generic `/__app/` relay). Same service as the app route
 * (`readCoherentProjection` + `buildScopedSignalCards`), output rebuilt field
 * by field per §5.2–§5.4 and validated by a strict schema (pattern
 * `validateReaderResponse`):
 * - `heads: []`, no `revisions` / `selection` / `facetFingerprint`;
 * - `sourceRef` forced to `null`, every storage key dropped;
 * - classification and B' provenances masked to the constant `"served"`;
 * - `props` reduced to the closed projection of §5.4 (fail-closed default);
 * - `documentUrl` rewritten server-side to the opaque `documents.pv.v1` op;
 * - `token` replaced by a reader-scoped digest (never the server token).
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { ClassificationError } from "../services/facets/classification-errors.js";
import { CitySlug, WorkspaceId } from "../services/facets/classification-query.js";
import { RegulatoryStageKind } from "@radar/domain";
import type { GraphSignalCard, GraphSignalDocRef, SignalEvidence } from "../routes/graph-signals.js";

/** Exact §5.5 params: workspace, city and the single served mode. */
export const coherentCityParams = z.object({
  workspaceId: WorkspaceId,
  citySlug: CitySlug,
  mode: z.literal("signal"),
}).strict();

export type CoherentCityParams = z.infer<typeof coherentCityParams>;

/** Surrogate-safe truncation, matching the `SignalCard` projection precedent. */
function cut(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  const truncated = value.slice(0, maximum);
  return /[\uD800-\uDBFF]$/.test(truncated) ? truncated.slice(0, -1) : truncated;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validBbox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const numbers = value.map(finiteNumber);
  return numbers.every((n): n is number => n !== null)
    ? [numbers[0]!, numbers[1]!, numbers[2]!, numbers[3]!]
    : null;
}

/**
 * Public municipal URL validation (§5.5, `publicDocumentUrl` precedent):
 * http(s), public host, no credential, bounded length, and no signed query.
 * Anything else is dropped — never transmitted.
 */
const SIGNED_QUERY_PARAM = /token|signature|sig|secret|auth|sas|apikey|api_key|access_?key/i;

function isPublicHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 8192) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch { return false; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username !== "" || parsed.password !== "") return false;
  const host = parsed.hostname.toLowerCase();
  if (host === "" || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")
    || host === "::1" || host === "[::1]" || host.startsWith("127.") || host.startsWith("10.")
    || host.startsWith("192.168.") || host.startsWith("169.254.")
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  for (const name of parsed.searchParams.keys()) {
    if (SIGNED_QUERY_PARAM.test(name)) return false;
  }
  return true;
}

function validPublicUrl(value: unknown): string | null {
  return isPublicHttpUrl(value) ? (value as string) : null;
}

/** Masked provenance: the excerpt stays (truncated), the storage key becomes `"served"`. */
function maskProvenance(provenance: { extrait?: unknown; source?: unknown }): {
  extrait?: string; source?: "served";
} {
  const out: { extrait?: string; source?: "served" } = {};
  if (typeof provenance.extrait === "string") out.extrait = cut(provenance.extrait, 2000);
  if (typeof provenance.source === "string" && provenance.source.length > 0) out.source = "served";
  return out;
}

// ── §5.4 closed `props` projection ──────────────────────────────────────────

/** Single short strings served verbatim (capped). */
const SHORT_STRING_KEYS = new Set([
  "category", "etape", "instrument",
  "date", "documentDate", "publishedAt", "meetingDate", "etapeDate", "etape_date", "meeting_date",
  "linkSource", "link_source",
]);

/** Free-text fields (capped at 2 000, feed zone inference and proof fallbacks). */
const TEXT_KEYS = new Set([
  "description", "summary", "details", "resume", "justification", "citation", "excerpt",
]);

/** Rule-number fields: string or finite number, arrays admitted for numbers. */
const REGLEMENT_KEYS = new Set([
  "reglement_number", "reglementNumber", "reglement_numero",
  "reglementNumbers", "bylaw", "reglement_millesime", "reglementMillesime", "millesime",
]);

/** Structured zone/lot refs: strings or string arrays only. */
const ZONE_LOT_KEYS = new Set([
  "zone_ref", "zoneRef", "zone_refs", "zones", "zone", "target_zone", "targets_zone",
  "lot_ref", "lotRef", "noLot", "no_lot", "lot", "lots", "target_lot", "targets_lot",
]);

/** Proof-fallback booleans. */
const PROOF_BOOL_KEYS = new Set([
  "provisional", "is_provisional", "isProvisional", "auto", "autoLinked",
]);

function projectStringArray(value: unknown, itemMax: number): string[] | null {
  if (!Array.isArray(value) || value.length > 32) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    out.push(item.slice(0, itemMax));
  }
  return out;
}

function projectReglementValue(value: unknown): string | number | Array<string | number> | null {
  if (typeof value === "string") return value.slice(0, 256);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.length <= 32) {
    const out: Array<string | number> = [];
    for (const item of value) {
      if (typeof item === "string") out.push(item.slice(0, 256));
      else if (typeof item === "number" && Number.isFinite(item)) out.push(item);
      else return null;
    }
    return out;
  }
  return null;
}

function projectStringOrArray(value: unknown): string | string[] | null {
  if (typeof value === "string") return value.slice(0, 256);
  return projectStringArray(value, 128);
}

function projectDocumentDate(value: unknown): string | { status: string; precision: string; value: string } | null {
  if (typeof value === "string") return value.slice(0, 256);
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 3 && keys.includes("status") && keys.includes("precision") && keys.includes("value")
      && typeof record.status === "string" && typeof record.precision === "string" && typeof record.value === "string") {
      return { status: record.status.slice(0, 128),
        precision: record.precision.slice(0, 128), value: record.value.slice(0, 256) };
    }
  }
  return null;
}

function projectRefItem(item: unknown): Record<string, unknown> | null {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
  const record = item as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ["excerpt", "citation", "quote", "text"]) {
    if (typeof record[key] === "string") out[key] = cut(record[key] as string, 2000);
  }
  if (typeof record.fetchedAt === "string") out.fetchedAt = (record.fetchedAt as string).slice(0, 256);
  if (typeof record.publishedAt === "string") out.publishedAt = (record.publishedAt as string).slice(0, 256);
  const documentDate = projectDocumentDate(record.documentDate);
  if (documentDate !== null) out.documentDate = documentDate;
  const page = finiteNumber(record.page);
  if (page !== null) out.page = page;
  const bbox = validBbox(record.bbox);
  if (bbox !== null) out.bbox = bbox;
  for (const key of PROOF_BOOL_KEYS) {
    if (typeof record[key] === "boolean") out[key] = record[key];
  }
  for (const key of ["linkSource", "link_source"]) {
    if (typeof record[key] === "string") out[key] = (record[key] as string).slice(0, 256);
  }
  return Object.keys(out).length > 0 ? out : null;
}

function projectPropsLevel(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const status = input.status ?? input.statut;
  if (typeof status === "string" && RegulatoryStageKind.safeParse(status).success) out.statut = status;
  if (typeof input.description === "string") out.description = cut(input.description, 2000);
  for (const key of TEXT_KEYS) {
    if (key === "description") continue;
    if (typeof input[key] === "string") out[key] = cut(input[key] as string, 2000);
  }
  for (const key of SHORT_STRING_KEYS) {
    if (typeof input[key] === "string") out[key] = (input[key] as string).slice(0, 1024);
  }
  for (const key of REGLEMENT_KEYS) {
    const projected = projectReglementValue(input[key]);
    if (projected !== null) out[key] = projected;
  }
  for (const key of ZONE_LOT_KEYS) {
    const projected = projectStringOrArray(input[key]);
    if (projected !== null) out[key] = projected;
  }
  const page = finiteNumber(input.page);
  if (page !== null) out.page = page;
  const bbox = validBbox(input.bbox);
  if (bbox !== null) out.bbox = bbox;
  for (const key of PROOF_BOOL_KEYS) {
    if (typeof input[key] === "boolean") out[key] = input[key];
  }
  return out;
}

/**
 * Closed projection of the ingestion passthrough (§5.4). Any key not listed
 * above — at any level — is dropped, including any future extraction key
 * (`adresse*`, `demandeur*`, storage keys, URLs, identities). Fail-closed default.
 */
export function projectProps(props: unknown): Record<string, unknown> {
  if (typeof props !== "object" || props === null || Array.isArray(props)) return {};
  const input = props as Record<string, unknown>;
  const out = projectPropsLevel(input);
  if (typeof input.properties === "object" && input.properties !== null && !Array.isArray(input.properties)) {
    const nested = projectPropsLevel(input.properties as Record<string, unknown>);
    if (Object.keys(nested).length > 0) out.properties = nested;
  }
  if (Array.isArray(input.refs)) {
    const refs: Record<string, unknown>[] = [];
    for (const item of input.refs.slice(0, 64)) {
      const projected = projectRefItem(item);
      if (projected !== null) refs.push(projected);
    }
    if (refs.length > 0) out.refs = refs;
  }
  return out;
}

// ── §5.5 document and evidence projection ───────────────────────────────────

const DOC_SHA = /^[a-f0-9]{64}$/;

export interface DocumentOpTarget {
  workspaceId: string;
  citySlug: string;
  nodeType: string;
  nodeId: string;
}

/** Rewrite to the opaque `documents.pv.v1` op — the storage key never travels. */
export function documentOpUrl(target: DocumentOpTarget, docSha: string): string {
  const query = `workspaceId=${encodeURIComponent(target.workspaceId)}`
    + `&citySlug=${encodeURIComponent(target.citySlug)}`
    + `&type=${encodeURIComponent(target.nodeType)}`
    + `&id=${encodeURIComponent(target.nodeId)}`
    + `&docSha=${encodeURIComponent(docSha)}`;
  return `/__reader/api/documents.pv.v1?${query}`;
}

export interface ProjectedDocRef {
  docSha: string;
  excerpt?: string;
  page?: number;
  sourceUrl?: string;
  documentUrl?: string;
  title?: string;
  contentType?: string;
  fetchedAt?: string;
  publishedAt?: string;
  bbox?: [number, number, number, number];
  provisional?: boolean;
  linkSource?: string;
}

/**
 * Project one card doc-ref. The ref is dropped entirely without a valid
 * `docSha`; `rawRef` is never served — `documentUrl` is always the op URL.
 */
export function projectDocRef(ref: GraphSignalDocRef, target: DocumentOpTarget): ProjectedDocRef | null {
  if (typeof ref.docSha !== "string" || !DOC_SHA.test(ref.docSha)) return null;
  const out: ProjectedDocRef = { docSha: ref.docSha,
    documentUrl: documentOpUrl(target, ref.docSha) };
  if (typeof ref.excerpt === "string") out.excerpt = cut(ref.excerpt, 2000);
  if (typeof ref.page === "number" && Number.isInteger(ref.page) && ref.page > 0) out.page = ref.page;
  const sourceUrl = validPublicUrl(ref.sourceUrl);
  if (sourceUrl !== null) out.sourceUrl = sourceUrl;
  if (typeof ref.title === "string") out.title = ref.title.slice(0, 1024);
  if (typeof ref.contentType === "string") out.contentType = ref.contentType.slice(0, 256);
  if (typeof ref.fetchedAt === "string") out.fetchedAt = ref.fetchedAt.slice(0, 256);
  if (typeof ref.publishedAt === "string") out.publishedAt = ref.publishedAt.slice(0, 256);
  const bbox = validBbox(ref.bbox);
  if (bbox !== null) out.bbox = bbox;
  if (typeof ref.provisional === "boolean") out.provisional = ref.provisional;
  if (typeof ref.linkSource === "string") out.linkSource = ref.linkSource.slice(0, 256);
  return out;
}

export interface ProjectedEvidenceRef {
  docSha: string | null;
  rawRef: null;
  rawObjectKey: null;
  citation: string | null;
  excerpt: string | null;
  sourceUrl: string | null;
  documentUrl: string | null;
  page: number | null;
  bbox: [number, number, number, number] | null;
  provisional: boolean;
  linkSource: string | null;
}

function projectEvidenceRef(
  ref: SignalEvidence["refs"][number], target: DocumentOpTarget,
): ProjectedEvidenceRef {
  const docSha = typeof ref.docSha === "string" && DOC_SHA.test(ref.docSha) ? ref.docSha : null;
  const sourceUrl = validPublicUrl(ref.sourceUrl);
  return {
    docSha,
    rawRef: null,
    rawObjectKey: null,
    citation: typeof ref.citation === "string" ? cut(ref.citation, 2000) : null,
    excerpt: typeof ref.excerpt === "string" ? cut(ref.excerpt, 2000) : null,
    sourceUrl,
    documentUrl: docSha !== null ? documentOpUrl(target, docSha) : validPublicUrl(ref.documentUrl),
    page: typeof ref.page === "number" && Number.isInteger(ref.page) && ref.page > 0 ? ref.page : null,
    bbox: validBbox(ref.bbox),
    provisional: ref.provisional === true,
    linkSource: typeof ref.linkSource === "string" ? ref.linkSource.slice(0, 256) : null,
  };
}

export interface ProjectedEvidence {
  description: string | null;
  rawRef: null;
  rawObjectKey: null;
  sourceRef: null;
  citation: string | null;
  excerpt: string | null;
  sourceUrl: string | null;
  documentUrl: string | null;
  documentDate: string | null;
  page: number | null;
  bbox: [number, number, number, number] | null;
  provisional: boolean;
  linkSource: string | null;
  refs: ProjectedEvidenceRef[];
  completeness: {
    hasDescription: boolean; hasCitationExcerpt: boolean; hasPdfLink: boolean;
    hasDocumentDate: boolean; hasPage: boolean; hasBbox: boolean;
    missing: Array<"description" | "citation" | "pdfLink" | "documentDate" | "page" | "bbox">;
  };
}

/**
 * Project evidence with nulled storage keys and recalculated completeness —
 * the projected links (not the removed ones) decide what is attested.
 */
export function projectEvidence(evidence: SignalEvidence, target: DocumentOpTarget): ProjectedEvidence {
  const refs = evidence.refs.map((ref) => projectEvidenceRef(ref, target));
  const description = typeof evidence.description === "string" ? cut(evidence.description, 2000) : null;
  const citation = typeof evidence.citation === "string" ? cut(evidence.citation, 2000) : null;
  const excerpt = typeof evidence.excerpt === "string" ? cut(evidence.excerpt, 2000) : null;
  const sourceUrl = validPublicUrl(evidence.sourceUrl);
  const documentUrl = refs.find((ref) => ref.documentUrl !== null)?.documentUrl ?? sourceUrl;
  const documentDate = typeof evidence.documentDate === "string" ? evidence.documentDate.slice(0, 256) : null;
  const page = typeof evidence.page === "number" && Number.isInteger(evidence.page) && evidence.page > 0
    ? evidence.page : null;
  const bbox = validBbox(evidence.bbox);
  const completeness = {
    hasDescription: description !== null,
    hasCitationExcerpt: citation !== null || excerpt !== null,
    hasPdfLink: sourceUrl !== null || documentUrl !== null,
    hasDocumentDate: documentDate !== null,
    hasPage: page !== null,
    hasBbox: bbox !== null,
    missing: [] as ProjectedEvidence["completeness"]["missing"],
  };
  if (!completeness.hasDescription) completeness.missing.push("description");
  if (!completeness.hasCitationExcerpt) completeness.missing.push("citation");
  if (!completeness.hasPdfLink) completeness.missing.push("pdfLink");
  if (!completeness.hasDocumentDate) completeness.missing.push("documentDate");
  if (!completeness.hasPage) completeness.missing.push("page");
  if (!completeness.hasBbox) completeness.missing.push("bbox");
  return {
    description, citation, excerpt, sourceUrl, documentUrl,
    // Storage keys are always null (§5.3): the overlay falls back to the
    // rewritten op `documentUrl`, never to a key.
    rawRef: null, rawObjectKey: null, sourceRef: null,
    documentDate, page, bbox,
    provisional: evidence.provisional === true,
    linkSource: typeof evidence.linkSource === "string" ? evidence.linkSource.slice(0, 256) : null,
    refs, completeness,
  };
}

// ── §5.5 signal assembly ───────────────────────────────────────────────────

export interface CoherentSignalSource {
  node: { id: string; type: string; citySlug: string | null; label: string; createdAt?: unknown };
  card: GraphSignalCard;
}

/**
 * Reader-scoped digest replacing the server token: stable for the
 * (artifact, reader) couple, non reversible, not correlatable across
 * artifacts, and bound to the exact server snapshot it acknowledges.
 */
export function deriveCoherentToken(input: {
  artifactId: string; readerSub: string; workspaceId: string; citySlug: string; serverToken: string;
}): string {
  return createHash("sha256").update(
    ["coherent-city-v1", input.artifactId, input.readerSub,
      input.workspaceId, input.citySlug, input.serverToken].join("\u0000"), "utf8",
  ).digest("hex");
}

function createdAtOf(node: CoherentSignalSource["node"]): string | null {
  const value = node.createdAt;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return typeof value === "string" ? value : null;
}

export function projectCoherentSignal(
  source: CoherentSignalSource, target: DocumentOpTarget,
): Record<string, unknown> {
  const { node, card } = source;
  const docRefs: ProjectedDocRef[] = [];
  for (const ref of card.docRefs) {
    const projected = projectDocRef(ref, target);
    if (projected !== null) docRefs.push(projected);
  }
  const classification = { ...card.classification, provenance: maskProvenance(card.classification.provenance) };
  const bPrime = { ...card.bPrime, provenance: maskProvenance(card.bPrime.provenance),
    ...(card.bPrime.etapeAnnotation !== undefined
      ? { etapeAnnotation: { raw: cut(card.bPrime.etapeAnnotation.raw, 256),
        valid: card.bPrime.etapeAnnotation.valid } } : {}) };
  return {
    id: node.id,
    type: node.type,
    label: cut(node.label, 1024),
    citySlug: node.citySlug,
    sourceRef: null,
    // Same source as the app body (card fields spread first): the card date,
    // the node date only as a fallback.
    createdAt: typeof card.createdAt === "string" ? card.createdAt : createdAtOf(node),
    description: typeof card.description === "string" ? cut(card.description, 8000) : null,
    publishedAt: typeof card.publishedAt === "string" ? card.publishedAt : null,
    etape: typeof card.etape === "string" ? card.etape.slice(0, 256) : null,
    regulatoryStatus: card.regulatoryStatus,
    classification,
    legacySubset: card.legacySubset,
    bPrime,
    docRefs,
    evidence: projectEvidence(card.evidence, target),
    props: projectProps(card.props),
  };
}

export interface CoherentCityAssembly {
  artifactId: string;
  readerSub: string;
  workspaceId: string;
  citySlug: string;
  serverToken: string;
  total: number;
  hidden: number;
  selected: number;
  legacyProjection: { version: "legacy-zmp-v1"; a: { count: number; signalIds: string[] } };
  sources: CoherentSignalSource[];
}

export function buildCoherentCityResponse(assembly: CoherentCityAssembly): Record<string, unknown> {
  const target: DocumentOpTarget = { workspaceId: assembly.workspaceId,
    citySlug: assembly.citySlug, nodeType: "", nodeId: "" };
  const signals = assembly.sources.map((source) => projectCoherentSignal(source,
    { ...target, nodeType: source.node.type, nodeId: source.node.id }));
  return {
    ok: true,
    workspaceId: assembly.workspaceId,
    citySlug: assembly.citySlug,
    mode: "signal",
    token: deriveCoherentToken({ artifactId: assembly.artifactId, readerSub: assembly.readerSub,
      workspaceId: assembly.workspaceId, citySlug: assembly.citySlug, serverToken: assembly.serverToken }),
    heads: [],
    signals,
    legacyProjection: assembly.legacyProjection,
    counts: { total: assembly.total, hidden: assembly.hidden,
      visible: signals.length, selected: assembly.selected },
  };
}

// ── §5.5 strict response schema ────────────────────────────────────────────

const countSchema = z.number().int().nonnegative();

const maskedProvenanceSchema = z.object({
  extrait: z.string().max(2000),
  source: z.literal("served").optional(),
}).strict();

const docRefSchema = z.object({
  docSha: z.string().regex(DOC_SHA),
  excerpt: z.string().max(2000).optional(),
  page: z.number().int().positive().optional(),
  sourceUrl: z.string().max(8192).optional(),
  documentUrl: z.string().max(8192).optional(),
  title: z.string().max(1024).optional(),
  contentType: z.string().max(256).optional(),
  fetchedAt: z.string().max(256).optional(),
  publishedAt: z.string().max(256).optional(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  provisional: z.boolean().optional(),
  linkSource: z.string().max(256).optional(),
}).strict();

const evidenceRefSchema = z.object({
  docSha: z.string().regex(DOC_SHA).nullable(),
  rawRef: z.null(),
  rawObjectKey: z.null(),
  citation: z.string().max(2000).nullable(),
  excerpt: z.string().max(2000).nullable(),
  sourceUrl: z.string().max(8192).nullable(),
  documentUrl: z.string().max(8192).nullable(),
  page: z.number().int().positive().nullable(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
  provisional: z.boolean(),
  linkSource: z.string().max(256).nullable(),
}).strict();

const completenessSchema = z.object({
  hasDescription: z.boolean(), hasCitationExcerpt: z.boolean(), hasPdfLink: z.boolean(),
  hasDocumentDate: z.boolean(), hasPage: z.boolean(), hasBbox: z.boolean(),
  missing: z.array(z.enum(["description", "citation", "pdfLink", "documentDate", "page", "bbox"])),
}).strict();

const evidenceSchema = z.object({
  description: z.string().max(2000).nullable(),
  rawRef: z.null(),
  rawObjectKey: z.null(),
  sourceRef: z.null(),
  citation: z.string().max(2000).nullable(),
  excerpt: z.string().max(2000).nullable(),
  sourceUrl: z.string().max(8192).nullable(),
  documentUrl: z.string().max(8192).nullable(),
  documentDate: z.string().max(256).nullable(),
  page: z.number().int().positive().nullable(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
  provisional: z.boolean(),
  linkSource: z.string().max(256).nullable(),
  refs: z.array(evidenceRefSchema),
  completeness: completenessSchema,
}).strict();

const signalSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  label: z.string().max(1024),
  citySlug: z.string().nullable(),
  sourceRef: z.null(),
  createdAt: z.string().nullable(),
  description: z.string().max(8000).nullable(),
  publishedAt: z.string().nullable(),
  etape: z.string().max(256).nullable(),
  regulatoryStatus: z.enum(["firm", "anticipation"]),
  classification: z.object({
    zonage: z.object({ valeur: z.enum(["oui", "non", "indetermine"]),
      source: z.string().min(1), confiance: z.number().min(0).max(1) }).strict(),
    residentiel: z.object({ valeur: z.enum(["oui", "non", "indetermine"]),
      source: z.string().min(1), confiance: z.number().min(0).max(1) }).strict(),
    effet_densifiant: z.string(),
    instrument: z.string(),
    etape: z.string(),
    etapes_historique: z.array(z.string()),
    exclusion_reason: z.string().nullable(),
    provenance: maskedProvenanceSchema,
    confiance: z.number().min(0).max(1),
  }).strict(),
  legacySubset: z.object({
    version: z.literal("legacy-zmp-v1"),
    signalId: z.string(),
    flags: z.object({ z: z.boolean(), m: z.boolean(), p: z.boolean() }).strict(),
  }).strict(),
  bPrime: z.object({
    etape: z.string(),
    etapeAnnotation: z.object({ raw: z.string().max(256), valid: z.boolean() }).strict().optional(),
    residentiel: z.enum(["oui", "non", "indetermine"]),
    exclusionReason: z.string().nullable(),
    provenance: maskedProvenanceSchema,
    effetDensifiant: z.string(),
  }).strict(),
  docRefs: z.array(docRefSchema),
  evidence: evidenceSchema,
  props: z.record(z.string(), z.unknown()),
}).strict();

export const coherentCityResponseSchema = z.object({
  ok: z.literal(true),
  workspaceId: z.string().guid(),
  citySlug: z.string().min(1).max(128),
  mode: z.literal("signal"),
  token: z.string().min(1),
  heads: z.array(z.never()),
  signals: z.array(signalSchema),
  legacyProjection: z.object({
    version: z.literal("legacy-zmp-v1"),
    a: z.object({ count: countSchema, signalIds: z.array(z.string()) }).strict(),
  }).strict(),
  counts: z.object({
    total: countSchema, hidden: countSchema, visible: countSchema, selected: countSchema,
  }).strict(),
}).strict().superRefine((body, context) => {
  if (body.counts.visible !== body.signals.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["counts", "visible"],
      message: "visible must equal the served signals" });
  }
  if (body.counts.total !== body.counts.hidden + body.counts.visible) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["counts", "total"],
      message: "total must equal hidden plus visible" });
  }
  const forbidden = scanForbiddenKeys(body);
  if (forbidden !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["signals"],
      message: `forbidden key served: ${forbidden}` });
  }
  for (const [index, signal] of body.signals.entries()) {
    if (!validPropsShape(signal.props)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["signals", index, "props"],
        message: "props escapes the closed projection" });
    }
  }
});

/**
 * Keys that must never reach the page anywhere in the DTO: storage keys,
 * internal identities, triage/write material. Legit lookalikes
 * (`docSha`, `sourceUrl`/`documentUrl` first-class, `source` inside
 * classifications) are NOT listed.
 */
const FORBIDDEN_KEYS = new Set([
  "sourceRef", "source_ref", "rawRef", "raw_ref", "rawObjectKey", "raw_object_key",
  "s3Key", "s3_key", "storageKey", "casKey", "source_file",
  "facetFingerprint", "revisions", "selection",
  "community", "community_name", "accountId",
  "file", "ref", "path", "sha", "sha256", "hash", "doc_sha",
  "url", "href", "apiUrl", "api_url", "pdfUrl", "pdf_url", "source_url",
]);

function scanForbiddenKeys(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = scanForbiddenKeys(item);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      // A forbidden key may only travel as an explicit `null` (§5.5:
      // `sourceRef`, `rawRef`, `rawObjectKey` are served null).
      if (FORBIDDEN_KEYS.has(key) && entry !== null) return key;
      const found = scanForbiddenKeys(entry);
      if (found !== null) return found;
    }
  }
  return null;
}

/** Props allowlist re-checked on the wire shape (builder + schema agree). */
const PROP_TOP_ALLOW = new Set([
  "statut", "description", "properties", "refs", "page", "bbox",
  ...SHORT_STRING_KEYS, ...TEXT_KEYS, ...REGLEMENT_KEYS, ...ZONE_LOT_KEYS, ...PROOF_BOOL_KEYS,
]);
const PROP_REF_ALLOW = new Set([
  "excerpt", "citation", "quote", "text", "fetchedAt", "publishedAt", "documentDate",
  "page", "bbox", "linkSource", "link_source",
  ...PROOF_BOOL_KEYS,
]);

function validPropsShape(props: unknown): boolean {
  if (typeof props !== "object" || props === null || Array.isArray(props)) return false;
  const input = props as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!PROP_TOP_ALLOW.has(key)) return false;
  }
  if (input.properties !== undefined) {
    if (typeof input.properties !== "object" || input.properties === null
      || Array.isArray(input.properties)) return false;
    for (const key of Object.keys(input.properties as Record<string, unknown>)) {
      if (!PROP_TOP_ALLOW.has(key) || key === "properties" || key === "refs") return false;
    }
  }
  if (input.refs !== undefined) {
    if (!Array.isArray(input.refs) || input.refs.length > 64) return false;
    for (const item of input.refs) {
      if (typeof item !== "object" || item === null || Array.isArray(item)) return false;
      for (const key of Object.keys(item as Record<string, unknown>)) {
        if (!PROP_REF_ALLOW.has(key)) return false;
      }
    }
  }
  return true;
}

/** Parse an assembled body through the strict schema; any deviation is a typed 502. */
export function parseCoherentCityResponse(value: unknown): Record<string, unknown> {
  const parsed = coherentCityResponseSchema.safeParse(value);
  if (!parsed.success) throw new ClassificationError("upstream_bad_payload");
  return parsed.data as Record<string, unknown>;
}
