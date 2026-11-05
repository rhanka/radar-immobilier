/**
 * Artifact-mode transport mapping for the Signaux zoning layer (J1 zonage).
 *
 * In the app, `fetchZones` (zones-client.ts) GETs
 * `/api/geo/collections/qc-zonage-<slug>/items?limit=3000`. On the artifact
 * content origin that route does not exist (field review j1-2b §7: no relay);
 * the governed reader operation `geo.collection-items.v1` serves the same
 * zones through a closed zoning projection, 200 features per page.
 *
 * This module is the mapping the J1.2d/e transport adapter calls — it never
 * performs network I/O itself: the adapter passes `invoke`, its existing
 * reader-bridge call (`GET /__reader/api/<op>?<params>` with the grant). The
 * result is a `Response` whose JSON body is an OGC FeatureCollection, so the
 * UNCHANGED `fetchZones` normaliser consumes it exactly as on the app path.
 *
 * Mapping:
 * - `…/collections/qc-zonage-<slug>/items?limit=N` → pages of
 *   `geo.collection-items.v1 {collectionId, limit<=200, offset}` following
 *   `nextOffset`, at most `min(N, 3000)` features (15 pages);
 * - op properties → OGC keys the app normaliser reads (`grillePdfUrl` is
 *   renamed `URL_Grille`; every other projection key is already a candidate);
 * - typed governance refusal (403 `geo_governed_not_served`: `not covered`,
 *   `unknown`, `not served`) and 404 → 404, which `fetchZones` reports as an
 *   absent collection (`ok:false`, no fake zero), so the loader falls back;
 * - 429 keeps its status and `Retry-After`; any other failure keeps its
 *   status (the loader surfaces a layer error, never an empty map).
 * Paths other than a zoning items collection return `null` (not mapped here).
 */

export const ZONES_READER_OPERATION = "geo.collection-items.v1" as const;
/** Page size: the op refuses more than 200 without bbox (review §6.3). */
export const ZONES_READER_PAGE_LIMIT = 200;
/** Page cap: 15 × 200 = 3000 = `ZONES_COLLECTION_LIMIT` of the loader. */
export const ZONES_READER_MAX_PAGES = 15;

/** Result of one reader-bridge call, as the adapter observed it. */
export interface ReaderOpResult {
  readonly status: number;
  readonly body: unknown;
  /** `Retry-After` seconds when the op answered 429. */
  readonly retryAfterSec?: number;
}

/** The adapter's reader-bridge call for `geo.collection-items.v1`. */
export type ZonesReaderInvoke = (
  op: typeof ZONES_READER_OPERATION,
  params: Readonly<Record<string, string>>,
  init?: { signal?: AbortSignal },
) => Promise<ReaderOpResult>;

export interface ZonesCollectionRequest {
  readonly collectionId: string;
  readonly citySlug: string;
  readonly limit: number | null;
}

const ZONES_ITEMS_PATH = /^\/api\/geo\/collections\/(qc-zonage-[a-z0-9-]+)\/items$/;

/**
 * Recognise the app's zoning items request. `qc-zonage-norms-*` is a
 * different family and is NOT mapped; any query key other than `limit`
 * (e.g. `bbox`) is not mapped either — the adapter then fails typed.
 */
export function parseZonesCollectionRequest(url: string): ZonesCollectionRequest | null {
  let parsed: URL;
  try {
    parsed = new URL(url, "http://artifact.invalid");
  } catch {
    return null;
  }
  const match = ZONES_ITEMS_PATH.exec(parsed.pathname);
  if (!match) return null;
  const collectionId = decodeURIComponent(match[1]!);
  if (collectionId.startsWith("qc-zonage-norms-")) return null;
  const keys = [...parsed.searchParams.keys()];
  if (keys.some((key) => key !== "limit") || keys.length > 1) return null;
  const rawLimit = parsed.searchParams.get("limit");
  const limit = rawLimit === null ? null : Number(rawLimit);
  if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1)) return null;
  return { collectionId, citySlug: collectionId.slice("qc-zonage-".length), limit };
}

interface ReaderItemsPage {
  type: "FeatureCollection";
  features: Array<{ type: "Feature"; geometry: unknown; properties: Record<string, unknown> }>;
  numberMatched: number;
  numberReturned: number;
  nextOffset: number | null;
  projection: string;
  collectionId: string;
  license: { id: string; title: string; href: string | null; attribution: string | null };
}

function isReaderItemsPage(value: unknown, collectionId: string): value is ReaderItemsPage {
  if (typeof value !== "object" || value === null) return false;
  const page = value as Partial<ReaderItemsPage>;
  return (
    page.type === "FeatureCollection" &&
    Array.isArray(page.features) &&
    typeof page.numberMatched === "number" &&
    (page.nextOffset === null || typeof page.nextOffset === "number") &&
    page.projection === "zoning-v1" &&
    page.collectionId === collectionId &&
    typeof page.license === "object" &&
    page.license !== null
  );
}

/** Op properties → the OGC keys `normalizeOgcZoneFeature` reads. */
export function readerZoningPropertiesToOgc(properties: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ["code", "kind", "affectation", "usages", "reglementMillesime", "reglementNumero", "reglementUrl", "proof", "immo_zone_lot_provenance"]) {
    if (properties[key] !== undefined) out[key] = properties[key];
  }
  if (properties.grillePdfUrl !== undefined) out.URL_Grille = properties.grillePdfUrl;
  return out;
}

function abortError(): Error {
  return typeof DOMException === "function"
    ? new DOMException("The operation was aborted.", "AbortError")
    : Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/**
 * Read a whole zoning collection through the reader op and answer as the
 * app route would. `null` when `url` is not a zoning items request.
 */
export async function zonesCollectionResponseViaReader(
  url: string,
  invoke: ZonesReaderInvoke,
  init: { signal?: AbortSignal } = {},
): Promise<Response | null> {
  const request = parseZonesCollectionRequest(url);
  if (!request) return null;
  const maxFeatures = Math.min(request.limit ?? ZONES_READER_PAGE_LIMIT * ZONES_READER_MAX_PAGES, ZONES_READER_PAGE_LIMIT * ZONES_READER_MAX_PAGES);
  const features: ReaderItemsPage["features"] = [];
  let numberMatched = 0;
  let license: ReaderItemsPage["license"] | null = null;
  let offset: number | null = 0;
  for (let page = 0; page < ZONES_READER_MAX_PAGES && offset !== null && features.length < maxFeatures; page += 1) {
    if (init.signal?.aborted) throw abortError();
    const limit = Math.min(ZONES_READER_PAGE_LIMIT, maxFeatures - features.length);
    const result = await invoke(
      ZONES_READER_OPERATION,
      { collectionId: request.collectionId, limit: String(limit), ...(offset > 0 ? { offset: String(offset) } : {}) },
      init,
    );
    if (result.status === 403 || result.status === 404) {
      // Governance refusal (not covered / unknown / not served) or absent
      // collection: the app's "collection not configured" path.
      return jsonResponse(404, { ok: false, error: "zones_collection_not_served", collectionId: request.collectionId });
    }
    if (result.status === 429) {
      return jsonResponse(
        429,
        { ok: false, error: "rate_limited" },
        result.retryAfterSec !== undefined ? { "retry-after": String(result.retryAfterSec) } : {},
      );
    }
    if (result.status !== 200) {
      return jsonResponse(result.status >= 400 ? result.status : 502, { ok: false, error: "zones_reader_failed" });
    }
    if (!isReaderItemsPage(result.body, request.collectionId)) {
      return jsonResponse(502, { ok: false, error: "zones_reader_unexpected_shape" });
    }
    if (page === 0) {
      numberMatched = result.body.numberMatched;
      license = result.body.license;
    }
    for (const feature of result.body.features) {
      if (features.length >= maxFeatures) break;
      features.push({ type: "Feature", geometry: feature.geometry, properties: readerZoningPropertiesToOgc(feature.properties) });
    }
    offset = result.body.nextOffset;
  }
  return jsonResponse(200, {
    type: "FeatureCollection",
    features,
    numberMatched,
    numberReturned: features.length,
    license,
  });
}

