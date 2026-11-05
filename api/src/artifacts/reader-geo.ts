/**
 * Reader geo service (lot I-1B, converged-geo-mesh r3 §2 "I-1B").
 *
 * Named reader operations `geo.cities.v1` and `geo.collection-items.v1` on
 * top of the merged governed geo facade (I-1A, #991). New file on purpose:
 * I2-partage rewrites `content-serve.ts` / `reader-storage.ts` /
 * `reader-operations.ts`, so everything I-1B owns lives here and the edits
 * there stay one-line, isolated blocks — easy rebase.
 *
 * Rules (r3 §1–§2, view-dev r2 I-1):
 * - Served catalogue only: known-licence `qc-zonage` collections with a
 *   dated per-collection record. Every other collection (including ALL
 *   `qc-lots-*` and `qc-zoning-events-*`) is a typed refusal BEFORE any
 *   upstream call — never a 200-empty.
 * - Bounded responses: `limit` default 200 / max 1000, `bbox` mandatory
 *   above 200, `offset` passthrough; FeatureCollections capped in features
 *   AND in bytes with `numberMatched` / `numberReturned` / `truncated`.
 * - Field allowlist per served collection (never a denylist alone):
 *   `adresse`, `code_postal*`, `extrait_brut` and `url_pdf` are never
 *   served, on the live path and on the pg-fallback path alike.
 * - Basket-consent classification (owned by I2-partage; recorded here until
 *   that merge lands): these operations serve municipal, non-personal
 *   catalogue data to an already-authorized reader and MUST NOT trigger the
 *   deferred basket consent. Triggers stay `baskets.*`, `signals.query.v1`
 *   and workspace discovery.
 */

import { DEFAULT_OGC_BASE_URL } from "../services/geo/ogc-pull.js";
import {
  GOVERNED_PILOT_CITY,
  GOVERNED_POLICY_VERSION,
  GOVERNED_SERVED_RECORDS,
  catalogueCollection,
  parseGovernedFamily,
  type ServedCollectionRecord,
} from "../services/geo/governed-policy.js";
import { serveZonageProperties } from "../routes/geo-governed.js";
import { isPublicCanonicalUrl } from "../services/geo/provenance.js";
import { ZONING_PROJECTION, projectZoningGeometry } from "../services/geo/zoning-projection.js";
import {
  readServedContractPointer,
  type ServedContractClient,
  type ServedContractEnv,
} from "../services/geo/served-contract-pointer.js";
import type { ReaderOperationName } from "./reader-operations.js";

/**
 * Basket-consent classification for the geo reader operations (see header).
 * `false` is the whole point: greppable by the I2-partage rebase.
 */
export const GEO_OPERATIONS_TRIGGER_BASKET_CONSENT = false as const;

/** Bounded items proxy bounds (view-dev r2 I-1, converged r3 §2 I-1B). */
export const GEO_READER_ITEMS_LIMIT_DEFAULT = 200;
export const GEO_READER_ITEMS_LIMIT_MAX = 1000;
/** A limit above this requires `bbox` (no province-wide over-fetch). */
export const GEO_READER_BBOX_REQUIRED_ABOVE = 200;
/** Serialized-features cap: responses are bounded in bytes as well. */
export const GEO_READER_MAX_BYTES = 1024 * 1024;
/** Upper bound of `offset` (largest known city ≈ 2 100 zones; generous). */
export const GEO_READER_OFFSET_MAX = 100_000;
/** Pseudo-field selecting the validated provenance envelopes. */
export const GEO_READER_PROVENANCE_FIELD = "provenance";
/** Bound on the served attribution string (display text from the listing). */
const ATTRIBUTION_MAX = 256;

export interface ReaderGeoCity {
  readonly citySlug: string;
  readonly zoneCount: number;
  readonly lotCount: number;
  readonly signalCount: number;
  readonly collections: readonly string[];
}

export interface ReaderCitiesResponse {
  readonly ok: true;
  readonly cities: readonly ReaderGeoCity[];
}

export interface ReaderCollectionItemsResponse {
  readonly type: "FeatureCollection";
  readonly features: ReadonlyArray<{
    readonly type: "Feature";
    readonly geometry: unknown;
    readonly properties: Record<string, unknown>;
  }>;
  readonly numberMatched: number;
  readonly numberReturned: number;
  readonly truncated: boolean;
  /** J1 zonage: next page offset, or null when this page is the last one. */
  readonly nextOffset: number | null;
  /** J1 zonage: `zoning-v1` (closed projection) or `allowlist` (raw keys). */
  readonly projection: "zoning-v1" | "allowlist";
  readonly collectionId: string;
  readonly licenseId: string;
  /** J1 zonage: licence record served with every page (attribution duty). */
  readonly license: {
    readonly id: string;
    readonly title: string;
    readonly href: string | null;
    readonly attribution: string | null;
  };
  readonly contract:
    | { readonly status: "ok"; readonly snapshot_sha256: string }
    | { readonly status: "missing source"; readonly reason: string };
}

/** Typed refusal thrown BEFORE any upstream call; the dispatch maps it. */
export class GeoItemsRefusal extends Error {
  readonly status: 400 | 403 | 404 | 502;
  readonly body: Record<string, unknown>;
  constructor(status: 400 | 403 | 404 | 502, body: Record<string, unknown>) {
    super(typeof body["error"] === "string" ? body["error"] : "geo_refused");
    this.name = "GeoItemsRefusal";
    this.status = status;
    this.body = body;
  }
}

export interface ReaderGeoLocalZoneResolver {
  (collectionId: string): Promise<{
    type: string;
    features: Array<{
      type: string;
      geometry: unknown;
      properties: Record<string, unknown>;
    }>;
  } | null>;
}

export interface ReaderGeoDeps {
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
  readonly servedRecords?: readonly ServedCollectionRecord[];
  /** Injectable city listing (default: none — the caller wires its store). */
  readonly listCitiesImpl?: () => Promise<
    ReadonlyArray<{
      readonly citySlug: string;
      readonly zoneCount: number;
      readonly lotCount: number;
      readonly signalCount: number;
    }>
  >;
  readonly localZoneResolver?: ReaderGeoLocalZoneResolver;
  readonly contractEnv?: ServedContractEnv;
  readonly contractClient?: ServedContractClient;
}

/**
 * Keep the cities of the DB listing that map to a served record.
 * A record covers a city when its id is `qc-zonage-<slug>` exactly or starts
 * with `qc-zonage-<slug>-` (e.g. the pilot
 * `qc-zonage-gatineau-affectations-territoire` covers `gatineau`). Pure, no
 * network — the same rule the pg-fallback resolver applies in reverse.
 */
export function filterServedCities(
  cities: ReadonlyArray<{
    readonly citySlug: string;
    readonly zoneCount: number;
    readonly lotCount: number;
    readonly signalCount: number;
  }>,
  records: readonly ServedCollectionRecord[] = [...GOVERNED_SERVED_RECORDS],
): ReaderGeoCity[] {
  const out: ReaderGeoCity[] = [];
  for (const city of cities) {
    const covered = records
      .filter(
        (record) =>
          record.collectionId === `qc-zonage-${city.citySlug}` ||
          // J1 zonage: a city zoning record names its city exactly, so it
          // never covers a prefix city (`saint-louis` vs
          // `saint-louis-de-gonzague-du-cap-tourmente`).
          (!record.zoning && record.collectionId.startsWith(`qc-zonage-${city.citySlug}-`)),
      )
      .map((record) => record.collectionId);
    if (covered.length > 0) out.push({ ...city, collections: covered });
  }
  return out;
}

export async function listReaderCities(deps: ReaderGeoDeps = {}): Promise<ReaderCitiesResponse> {
  const cities = await deps.listCitiesImpl?.() ?? [];
  return {
    ok: true as const,
    cities: filterServedCities(cities, [...(deps.servedRecords ?? GOVERNED_SERVED_RECORDS)]),
  };
}

function refusalBody(
  collectionId: string,
  status: "served" | "not covered" | "unknown" | "not served",
  reason: string,
): Record<string, unknown> {
  return {
    ok: false,
    error: "geo_governed_not_served",
    collectionId,
    status,
    reason,
  };
}

export interface ReaderCollectionItemsOptions {
  readonly limit?: number;
  readonly bbox?: string;
  readonly offset?: number;
  /** Field projection: subset of the record's served fields (+ `provenance`). */
  readonly fields?: readonly string[];
}

function displayText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  // eslint-disable-next-line no-control-regex
  if (trimmed.length === 0 || trimmed.length > ATTRIBUTION_MAX || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

function nextOffsetOf(offset: number, returned: number, matched: number): number | null {
  const next = offset + returned;
  return returned > 0 && next < matched ? next : null;
}

export async function readReaderCollectionItems(
  deps: ReaderGeoDeps,
  collectionId: string,
  options: ReaderCollectionItemsOptions = {},
): Promise<ReaderCollectionItemsResponse> {
  const records = [...(deps.servedRecords ?? GOVERNED_SERVED_RECORDS)];
  const fetchImpl = deps.fetchImpl ?? fetch;
  const baseUrl = (deps.baseUrl ?? process.env["GEO_OGC_BASE_URL"] ?? DEFAULT_OGC_BASE_URL).replace(/\/$/, "");

  // 1. Family gate: only zonage can hold a record — refuse with no call.
  const family = parseGovernedFamily(collectionId);
  if (family !== "zonage") {
    throw new GeoItemsRefusal(
      403,
      refusalBody(collectionId, "not served", `family-${family}-deferred-in-i1a`),
    );
  }
  // 2. Record gate: no dated per-collection line — refuse with no call.
  const record = records.find((entry) => entry.collectionId === collectionId);
  if (!record) {
    throw new GeoItemsRefusal(
      403,
      refusalBody(collectionId, "not covered", "no-dated-per-collection-record"),
    );
  }
  // 3. Bound gate: a high limit without bbox is refused with no call.
  const limit = options.limit ?? GEO_READER_ITEMS_LIMIT_DEFAULT;
  if (limit > GEO_READER_BBOX_REQUIRED_ABOVE && !options.bbox) {
    throw new GeoItemsRefusal(
      400,
      {
        ok: false,
        error: "geo_bbox_required",
        collectionId,
        limit,
        detail: `limit above ${GEO_READER_BBOX_REQUIRED_ABOVE} requires bbox`,
      },
    );
  }
  // 3b. Field projection gate: only served fields (plus the provenance
  // pseudo-field) may be requested — refused with no call.
  const requestable = new Set<string>([...record.servedFields, GEO_READER_PROVENANCE_FIELD]);
  const unknownField = options.fields?.find((field) => !requestable.has(field));
  if (unknownField !== undefined) {
    throw new GeoItemsRefusal(400, { ok: false, error: "geo_field_not_served", collectionId });
  }
  const offset = options.offset ?? 0;

  // 4. Live licence re-check: a licence turned `unknown` since the record
  // date refuses at the next read (one listing call per items request; the
  // I-1A 10-minute listing cache is not reused here).
  let listing: Array<{
    id: string;
    licenseTitle?: unknown;
    licenseHref?: unknown;
    attribution?: unknown;
    rightsPresent: boolean;
  }>;
  try {
    const res = await fetchImpl(`${baseUrl}/collections?f=json&limit=10000`);
    if (!res.ok) throw new Error(`listing HTTP ${res.status}`);
    const body = (await res.json()) as {
      collections?: Array<{
        id?: unknown;
        license?: { title?: unknown; href?: unknown } | null;
        attribution?: unknown;
        rights?: unknown;
      }>;
    };
    const collections = Array.isArray(body.collections) ? body.collections : [];
    listing = collections.flatMap((raw) =>
      typeof raw.id === "string" && raw.id.length > 0
        ? [{
          id: raw.id,
          licenseTitle: raw.license?.title,
          licenseHref: raw.license?.href,
          attribution: raw.attribution,
          rightsPresent: raw.rights !== null && raw.rights !== undefined,
        }]
        : [],
    );
  } catch {
    throw new GeoItemsRefusal(
      502,
      { ok: false, error: "geo_governed_listing_unreachable", collectionId },
    );
  }
  const live = listing.find((entry) => entry.id === collectionId);
  const entry = catalogueCollection(
    live ?? { id: collectionId, licenseTitle: undefined, rightsPresent: false },
    records,
  );
  if (entry.status !== "served" || !entry.record) {
    throw new GeoItemsRefusal(
      403,
      refusalBody(collectionId, entry.status, entry.reason ?? "catalogue-refused"),
    );
  }

  const zoning = entry.record.zoning !== undefined;
  const projection = zoning ? ZONING_PROJECTION : "allowlist" as const;
  const licenseHref = live?.licenseHref;
  const license = {
    id: entry.record.licenseId,
    title: entry.record.matchedTitle,
    href: isPublicCanonicalUrl(licenseHref) ? licenseHref : null,
    attribution: displayText(live?.attribution),
  };
  const fields = options.fields;
  const serve = (feature: { geometry?: unknown; properties?: Record<string, unknown> | null }, origin: "live" | "pg-fallback") => {
    const all = serveZonageProperties(collectionId, { ...(feature.properties ?? {}) }, records, origin);
    const properties = fields
      ? Object.fromEntries(Object.entries(all).filter(([key]) =>
        fields.includes(key) || (fields.includes(GEO_READER_PROVENANCE_FIELD) && (key === "proof" || key === "immo_zone_lot_provenance"))))
      : all;
    return {
      type: "Feature" as const,
      // Zoning records: §6.4 geometry projection (known type, finite numbers).
      geometry: zoning ? projectZoningGeometry(feature.geometry) : feature.geometry ?? null,
      properties,
    };
  };

  const params = new URLSearchParams();
  params.set("limit", String(Math.min(limit, GEO_READER_ITEMS_LIMIT_MAX)));
  if (options.bbox) params.set("bbox", options.bbox);
  if (options.offset !== undefined) params.set("offset", String(options.offset));
  params.set("f", "json");

  const pointer = await readServedContractPointer({
    env: deps.contractEnv ?? (process.env as ServedContractEnv),
    ...(deps.contractClient ? { client: deps.contractClient } : {}),
  });
  const contract =
    pointer.status === "ok"
      ? { status: "ok" as const, snapshot_sha256: pointer.snapshotSha256 }
      : { status: "missing source" as const, reason: pointer.reason };

  let liveRes: Response;
  try {
    liveRes = await fetchImpl(`${baseUrl}/collections/${encodeURIComponent(collectionId)}/items?${params.toString()}`);
  } catch {
    liveRes = new Response(null, { status: 502 });
  }
  if (liveRes.ok) {
    const body = (await liveRes.json()) as {
      features?: Array<{ type?: unknown; geometry?: unknown; properties?: Record<string, unknown> }>;
      numberMatched?: number;
    };
    const features = Array.isArray(body.features) ? body.features : [];
    const served = features.map((feature) => serve(feature, "live"));
    const numberMatched = typeof body.numberMatched === "number" ? body.numberMatched : served.length;
    // Facade cap: an upstream returning more than asked is sliced to
    // `limit` before the byte cap, so the response stays bounded in
    // features AND in bytes with `truncated` set.
    const capped = served.slice(0, Math.min(limit, GEO_READER_ITEMS_LIMIT_MAX));
    const bounded = boundReaderFeatures(capped);
    return {
      type: "FeatureCollection",
      features: bounded.features,
      numberMatched,
      numberReturned: bounded.features.length,
      truncated: bounded.features.length < capped.length || numberMatched > bounded.features.length,
      nextOffset: nextOffsetOf(offset, bounded.features.length, numberMatched),
      projection,
      collectionId,
      licenseId: entry.record.licenseId,
      license,
      contract,
    };
  }

  // Live failed: pg-fallback through the SAME allowlist (banned keys never
  // leave on any path), then an honest error — never a 200-empty.
  try {
    const local = await deps.localZoneResolver?.(collectionId);
    if (local && local.features.length > 0) {
      // The local store has no paging: `offset` slices it like the upstream.
      const fallen = local.features.slice(offset).map((feature) => serve(feature, "pg-fallback"));
      const capped = fallen.slice(0, Math.min(limit, GEO_READER_ITEMS_LIMIT_MAX));
      const bounded = boundReaderFeatures(capped);
      return {
        type: "FeatureCollection",
        features: bounded.features,
        numberMatched: local.features.length,
        numberReturned: bounded.features.length,
        truncated:
          bounded.features.length < capped.length || local.features.length > bounded.features.length,
        nextOffset: nextOffsetOf(offset, bounded.features.length, local.features.length),
        projection,
        collectionId,
        licenseId: entry.record.licenseId,
        license,
        contract,
      };
    }
  } catch {
    // Fall through to the honest error below.
  }
  if (liveRes.status === 404) {
    throw new GeoItemsRefusal(404, { ok: false, error: "collection_not_found", collectionId });
  }
  throw new GeoItemsRefusal(
    502,
    { ok: false, error: "geo_proxy_error", collectionId, status: liveRes.status },
  );
}

/**
 * Byte-cap only: callers slice the feature COUNT to
 * `min(limit, GEO_READER_ITEMS_LIMIT_MAX)` first, then this caps the
 * serialized bytes. Never call it on an uncapped upstream page.
 */
function boundReaderFeatures(
  features: Array<{ type: "Feature"; geometry: unknown; properties: Record<string, unknown> }>,
): { features: Array<{ type: "Feature"; geometry: unknown; properties: Record<string, unknown> }> } {
  let kept = features;
  while (kept.length > 0 && Buffer.byteLength(JSON.stringify(kept), "utf8") > GEO_READER_MAX_BYTES) {
    kept = kept.slice(0, kept.length - 1);
  }
  return { features: kept };
}

/** Thin dispatch for the content host: params are pre-validated there. */
export function createGeoReadOperation(deps: ReaderGeoDeps): (
  op: ReaderOperationName,
  params: unknown,
) => Promise<unknown> {
  return async (op, params) => {
    if (op === "geo.cities.v1") return listReaderCities(deps);
    if (op === "geo.collection-items.v1") {
      const input = params as Omit<ReaderCollectionItemsOptions, "fields"> & { collectionId: string; fields?: string };
      return readReaderCollectionItems(deps, input.collectionId, {
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
        ...(input.bbox !== undefined ? { bbox: input.bbox } : {}),
        ...(input.offset !== undefined ? { offset: input.offset } : {}),
        ...(input.fields !== undefined ? { fields: input.fields.split(",") } : {}),
      });
    }
    throw new Error("Capability unavailable");
  };
}

/** Pilot city of the served catalogue (single source: the I-1A policy). */
export function readerGeoPilotCity(): string {
  return GOVERNED_PILOT_CITY;
}

/** Instance policy version backing the served catalogue. */
export function readerGeoPolicyVersion(): string {
  return GOVERNED_POLICY_VERSION;
}
