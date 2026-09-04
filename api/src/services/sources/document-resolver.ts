import { readFileSync } from "node:fs";
import { RawDocumentRecordSchema, rawMetaKey } from "@radar/sources";
import { isMissingObjectError } from "../../storage/s3-object-store.js";

import type { ObjectReader } from "../../storage/object-store.js";

const RAW_PREFIX = "raw/";
const META_SUFFIX = ".meta.json";

/**
 * immo→geo document repoint — pure, O(1) CAS-key prefix rewrite (NO bucket scan).
 *
 * The immo RECUEIL pipeline stores each procès-verbal document under a
 * content-addressed key `raw/proces-verbaux-<city>/cas/<sha256>.<ext>`. geo holds
 * the byte-identical document under `raw/pv-index/cas/<sha256>.<ext>` — SAME bare
 * 64-hex sha256 of the exact same bytes (no `sha256:` prefix on either side) and,
 * per the geo writer's contract (`acquisition/src/pv-couverture-municipale.ts`,
 * `CAS_PREFIX="raw/pv-index/cas/"`), the SAME real file extension. So the map is a
 * single prefix rewrite that carries BOTH the hash AND the extension across
 * unchanged. It is a constant-cost string operation: NEVER a `list`/scan of the
 * bucket (that unbounded fallback caused the "signal API never responds" incident
 * — see findDocumentMetadata below).
 *
 * Extension is PRESERVED, not hardcoded — geo keys the real file type (`.pdf`,
 * `.docx`, …), so forcing `.pdf` would 404 the non-PDF documents. The rewrite is
 * bounded to legitimate DOCUMENT payload extensions (`DOC_EXTS`): immo-internal
 * artifacts written under the same prefix (extracted text `.txt`, index `.html`,
 * unknown-type `.bin`) are deliberately NOT mapped — they return `null` here and
 * keep resolving on the immo legacy stores rather than 404-ing against a geo key
 * that does not exist.
 *
 * Contract, enforced by the regexes below:
 *  - `raw/proces-verbaux-<city>/cas/<64-hex>.<docext>` → `raw/pv-index/cas/<64-hex>.<docext>`
 *  - an already-geo key `raw/pv-index/cas/<64-hex>.<docext>` maps to itself (idempotent)
 *  - anything else (non-PV source, non-document ext, `.meta.json` sidecar,
 *    non-64-hex or uppercase sha, empty city, nested/traversal path) returns
 *    `null` — the mapper NEVER fabricates a geo key it cannot derive from the
 *    exact CAS contract.
 *
 * KNOWN GAP (docx): immo derives its key extension from the fetched content-type
 * via `extForContentType`, which has NO docx case — a `.docx` PV is therefore
 * keyed `<sha>.bin` (direct download) or `<sha>.html` (Office-viewer entry) in
 * immo, NOT `<sha>.docx`. geo keys the same document by its REAL extension
 * (`<sha>.docx`). A pure key rewrite cannot bridge that: `.bin`/`.html` are not
 * document exts here, so those PVs stay on immo (no 404). Fully repointing docx
 * needs the extension conventions aligned at the data layer (immo emitting the
 * real ext, or the resolver recovering it from the doc), which is out of scope
 * for an O(1) key rewrite.
 */
const GEO_PV_CAS_PREFIX = "raw/pv-index/cas/";
/**
 * Legitimate document payload extensions geo mirrors by their REAL file type.
 * PDFs are the majority; docx/doc/odt/rtf cover the office-document PVs. NOT
 * included: `.bin`/`.html`/`.txt`/`.json`/`.xml` — those are immo-internal or
 * intermediate artifacts, never a geo `raw/pv-index/cas/` document.
 */
const DOC_EXTS = "pdf|docx|doc|odt|rtf";
/** A content-addressed document object: lowercase sha256 hex + a document ext. */
const CAS_DOC = `([a-f0-9]{64}\\.(?:${DOC_EXTS}))`;
/**
 * An immo PV CAS key: `raw/proces-verbaux-<city-slug>/cas/<sha>.<docext>`.
 * The city slug is a source id that joins municipality and MRC with a DOUBLE
 * hyphen (24 real ids, e.g. `saint-stanislas--des-chenaux`,
 * `notre-dame-du-bon-conseil--drummond--2`), so segments are separated by one
 * OR MORE hyphens — `-+` — while start/end stay alphanumeric (no leading/
 * trailing hyphen, no `/`, no `.` — traversal/nesting still rejected).
 */
const IMMO_PV_CAS_KEY = new RegExp(
  `^raw/proces-verbaux-[a-z0-9]+(?:-+[a-z0-9]+)*/cas/${CAS_DOC}$`,
);
/** An already-canonical geo PV CAS key: `raw/pv-index/cas/<sha>.<docext>`. */
const GEO_PV_CAS_KEY = new RegExp(`^${GEO_PV_CAS_PREFIX}${CAS_DOC}$`);

export function mapToGeoKey(key: string): string | null {
  if (GEO_PV_CAS_KEY.test(key)) return key; // idempotent: already a geo key
  const match = IMMO_PV_CAS_KEY.exec(key);
  // match[1] is the verbatim `<64-hex>.<ext>` tail of the immo key: the sha and
  // the real extension are copied across unchanged (no `sha256:` prefix added).
  return match?.[1] ? `${GEO_PV_CAS_PREFIX}${match[1]}` : null;
}

/**
 * A PV CAS key with ANY lowercase extension (not just the geo doc exts): still
 * `raw/proces-verbaux-<slug>/cas/<64hex>.<ext>`, so `.bin`/`.html` (the immo
 * docx artifacts `mapToGeoKey` rejects) qualify, while non-PV sources, sidecars
 * (`.pdf.meta.json` — the extra dots fail `[a-z0-9]+$`), uppercase sha and
 * traversal do NOT. Gates whether a URL-index lookup may be attempted at all.
 */
const IMMO_PV_CAS_KEY_ANY_EXT = new RegExp(
  `^raw/proces-verbaux-[a-z0-9]+(?:-+[a-z0-9]+)*/cas/[a-f0-9]{64}\\.[a-z0-9]+$`,
);

/**
 * Frozen geo index contract (geo-socle PR #274). The RAW source url — the exact
 * `sourceUrl` from immo's `.meta.json`, matched VERBATIM, never normalized —
 * maps to the canonical geo CAS key. This resolves what `mapToGeoKey` cannot:
 * the re-scrape divergence (same source url, geo sha ≠ immo sha) and the docx
 * extension gap (immo `.bin`/`.html` → geo `.docx`). A url geo captured under
 * ≥2 sha (`drift`) is fail-closed — `geo_cas_key` is null so the lookup returns
 * null → a frank 404, never an ambiguous guess.
 */
export interface GeoIndexEntry {
  readonly geo_cas_key: string | null;
  readonly drift?: boolean;
}

export interface GeoKeyIndex {
  /** Canonical geo CAS key for a raw source url; null = unknown or drift. */
  lookupByUrl(sourceUrl: string): string | null;
}

interface GeoIndexDocument {
  readonly resolve_by_source_url?: Record<string, GeoIndexEntry>;
}

/**
 * Build an in-memory {@link GeoKeyIndex} from the frozen index JSON. Drift
 * entries and null keys are dropped at load time, so `lookupByUrl` returns null
 * for them (→ 404 franc). Lookup is an EXACT map hit — the url is never
 * normalized, per the contract.
 */
export function parseGeoKeyIndex(json: unknown): GeoKeyIndex {
  const table = (json as GeoIndexDocument | null)?.resolve_by_source_url ?? {};
  const map = new Map<string, string>();
  for (const [url, entry] of Object.entries(table)) {
    if (entry && entry.drift !== true && typeof entry.geo_cas_key === "string") {
      map.set(url, entry.geo_cas_key);
    }
  }
  return {
    lookupByUrl: (sourceUrl) => map.get(sourceUrl) ?? null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseGeoKeyIndexGuarded(
  json: unknown,
  path: string,
): GeoKeyIndex | undefined {
  if (!isRecord(json) || !isRecord(json.resolve_by_source_url)) {
    console.warn(
      `geo document URL index at ${path} has no valid "resolve_by_source_url" object; URL fallback disabled`,
    );
    return undefined;
  }
  return parseGeoKeyIndex(json);
}

/**
 * Load the optional frozen geo source-url→CAS-key index from disk.
 * Missing, unreadable, malformed, or invalid-shaped files disable URL fallback
 * without preventing the API from starting, with one warning per load attempt.
 */
export function loadGeoKeyIndex(path: string): GeoKeyIndex | undefined {
  try {
    const json = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parseGeoKeyIndexGuarded(json, path);
  } catch (error) {
    console.warn(
      `Unable to load geo document URL index from ${path}: ${String(error)}`,
    );
    return undefined;
  }
}

/**
 * Candidate geo CAS keys for a PV rawRef, in priority order — PURE, no I/O:
 *  1. `mapToGeoKey` (sha-preserving rewrite) — the majority where geo's bytes
 *     carry immo's sha.
 *  2. URL-index lookup — the re-scrape divergence and the docx `.bin`/`.html`
 *     gap, only when a source url AND an index are supplied.
 * The caller HEADs these against the geo reader in order; none existing → 404
 * (fail-closed: still NO immo fallback for a PV key). A non-PV / non-CAS key
 * yields `[]`, so the route keeps its untouched legacy behavior.
 */
export function geoKeyCandidates(
  rawRef: string,
  opts?: { sourceUrl?: string | null; index?: GeoKeyIndex | null },
): string[] {
  const out: string[] = [];
  const shaKey = mapToGeoKey(rawRef);
  if (shaKey) out.push(shaKey);
  const sourceUrl = opts?.sourceUrl;
  const index = opts?.index;
  if (sourceUrl && index && IMMO_PV_CAS_KEY_ANY_EXT.test(rawRef)) {
    const byUrl = index.lookupByUrl(sourceUrl);
    if (byUrl && !out.includes(byUrl)) out.push(byUrl);
  }
  return out;
}

export interface DocumentMetadata {
  readonly rawRef: string;
  readonly docSha: string;
  readonly sourceUrl: string;
  readonly contentType: string;
  readonly fetchedAt: string;
  readonly title?: string;
  readonly publishedAt?: string;
}

const decoder = new TextDecoder();

function tryParseJson(bytes: Uint8Array): unknown | null {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    return null;
  }
}

export function isSafeRawRef(rawRef: string): boolean {
  return normalizeRawRef(rawRef) !== null;
}

export function normalizeRawRef(rawRef: string): string | null {
  const trimmed = rawRef.trim();
  const rawIndex = trimmed.indexOf(RAW_PREFIX);
  const normalized = rawIndex >= 0 ? trimmed.slice(rawIndex) : trimmed;
  return (
    normalized.startsWith(RAW_PREFIX) &&
    !normalized.endsWith(META_SUFFIX) &&
    !normalized.includes("..") &&
    !normalized.includes("\0")
  )
    ? normalized
    : null;
}

export function apiDocumentUrl(rawRef: string): string {
  return `/api/documents/raw?rawRef=${encodeURIComponent(normalizeRawRef(rawRef) ?? rawRef)}`;
}

export async function loadDocumentMetadata(
  store: ObjectReader,
  rawRef: string,
): Promise<DocumentMetadata | null> {
  const normalizedRawRef = normalizeRawRef(rawRef);
  if (!normalizedRawRef) return null;

  const head = await store.head(rawMetaKey(normalizedRawRef));
  if (!head) return null;

  const parsed = RawDocumentRecordSchema.safeParse(
    tryParseJson(await store.get(rawMetaKey(normalizedRawRef))),
  );
  if (!parsed.success) return null;

  const record = parsed.data;
  return {
    rawRef: record.storageKey,
    docSha: record.sha256,
    sourceUrl: record.sourceUrl,
    contentType: record.contentType,
    fetchedAt: record.fetchedAt,
    ...(record.title !== undefined ? { title: record.title } : {}),
    ...(record.publishedAt !== undefined ? { publishedAt: record.publishedAt } : {}),
  };
}

/**
 * Resolves a document's metadata by rawRef ONLY — direct `.meta.json` lookup,
 * O(1) object-store calls, no bucket scan.
 *
 * INCIDENT "signal API never responds": the former docSha fallback listed the
 * whole bucket (`store.list("raw/")`, ~20k keys) then GET'ed every
 * `.meta.json` sequentially (~50 min) as soon as ONE rawRef was missing its
 * `.meta.json` in S3. Launched per node by the per-city route, the endpoint
 * never answered. The fallback is REMOVED: a missing meta now degrades to
 * `null` (the ref is served without document metadata, the endpoint always
 * responds). Any future docSha lookup MUST be strictly bounded (time budget
 * or iteration cap) — never an unbounded full scan.
 *
 * `params.docSha` is kept in the signature for call-site compatibility but is
 * deliberately NOT used as a lookup key anymore.
 */
export async function findDocumentMetadata(
  store: ObjectReader,
  params: { rawRef?: string; docSha?: string },
): Promise<DocumentMetadata | null> {
  if (!params.rawRef) return null;
  return loadDocumentMetadata(store, params.rawRef);
}

/**
 * Content type inferred from a CAS key's real extension. Geo `raw/pv-index/cas/`
 * objects carry the true file type in the key but need not have an S3
 * `Content-Type` nor a `.meta.json` sidecar, so a `.pdf` key must still be
 * served as `application/pdf` (not `application/octet-stream`, which makes the
 * browser download instead of inline-view the PV).
 */
const EXT_CONTENT_TYPE: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
};

function contentTypeFromKey(key: string): string | undefined {
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  return EXT_CONTENT_TYPE[ext];
}

export async function resolveRawContentType(
  store: ObjectReader,
  rawRef: string,
): Promise<string> {
  const head = await store.head(rawRef);
  if (head?.contentType) return head.contentType;
  // A sidecar that vanishes between its own head and get (TOCTOU) must not throw
  // here: content type is best-effort, the payload was already served. Degrade
  // to the key extension / default on a genuine MISS only — a real fault
  // (access/config/network) still propagates so it is not silently masked.
  const meta = await loadDocumentMetadata(store, rawRef).catch((e) => {
    if (isMissingObjectError(e)) return null;
    throw e;
  });
  return (
    meta?.contentType ??
    contentTypeFromKey(rawRef) ??
    "application/octet-stream"
  );
}
