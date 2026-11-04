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
  readonly collectionId: string;
  readonly licenseId: string;
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
          record.collectionId.startsWith(`qc-zonage-${city.citySlug}-`),
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

  // 4. Live licence re-check: a licence turned `unknown` since the record
  // date refuses at the next read (one cached-by-caller listing call).
  let listing: Array<{ id: string; licenseTitle?: unknown; rightsPresent: boolean }>;
  try {
    const res = await fetchImpl(`${baseUrl}/collections?f=json&limit=10000`);
    if (!res.ok) throw new Error(`listing HTTP ${res.status}`);
    const body = (await res.json()) as {
      collections?: Array<{ id?: unknown; license?: { title?: unknown } | null; rights?: unknown }>;
    };
    const collections = Array.isArray(body.collections) ? body.collections : [];
    listing = collections.flatMap((raw) =>
      typeof raw.id === "string" && raw.id.length > 0
        ? [{ id: raw.id, licenseTitle: raw.license?.title, rightsPresent: raw.rights !== null && raw.rights !== undefined }]
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
    const served = features.map((feature) => ({
      type: "Feature" as const,
      geometry: feature.geometry ?? null,
      properties: serveZonageProperties(collectionId, { ...(feature.properties ?? {}) }, records),
    }));
    const numberMatched = typeof body.numberMatched === "number" ? body.numberMatched : served.length;
    const bounded = boundReaderFeatures(served);
    return {
      type: "FeatureCollection",
      features: bounded.features,
      numberMatched,
      numberReturned: bounded.features.length,
      truncated: bounded.features.length < served.length || numberMatched > bounded.features.length,
      collectionId,
      licenseId: entry.record.licenseId,
      contract,
    };
  }

  // Live failed: pg-fallback through the SAME allowlist (banned keys never
  // leave on any path), then an honest error — never a 200-empty.
  try {
    const local = await deps.localZoneResolver?.(collectionId);
    if (local && local.features.length > 0) {
      const fallen = local.features.map((feature) => ({
        type: "Feature" as const,
        geometry: feature.geometry ?? null,
        properties: serveZonageProperties(collectionId, { ...(feature.properties ?? {}) }, records),
      }));
      const bounded = boundReaderFeatures(fallen.slice(0, Math.min(limit, GEO_READER_ITEMS_LIMIT_MAX)));
      return {
        type: "FeatureCollection",
        features: bounded.features,
        numberMatched: local.features.length,
        numberReturned: bounded.features.length,
        truncated:
          bounded.features.length < Math.min(local.features.length, Math.min(limit, GEO_READER_ITEMS_LIMIT_MAX)),
        collectionId,
        licenseId: entry.record.licenseId,
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

/** Cap the served features in bytes (features already capped in count). */
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
      const input = params as ReaderCollectionItemsOptions & { collectionId: string };
      return readReaderCollectionItems(deps, input.collectionId, {
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
        ...(input.bbox !== undefined ? { bbox: input.bbox } : {}),
        ...(input.offset !== undefined ? { offset: input.offset } : {}),
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
