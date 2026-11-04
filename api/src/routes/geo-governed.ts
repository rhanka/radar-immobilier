/**
 * Governed geo facade (I-1A, converged r3 §2).
 *
 * In-process service + governed route, DISTINCT from the existing public
 * prefix `/api/geo/collections` (unchanged, ungated, untouched by this lot).
 * The governed root below is FROZEN (P3): do not rename without an owner
 * decision. When auth is enabled the route is session-gated by `protect`
 * (it is NOT in PUBLIC_PREFIXES); the public prefix stays public per C1.
 *
 * - GET /api/v1/geo-governed/catalog — catalogue derived from the live
 *   `/collections` listing: served zonage entries plus every other
 *   collection listed not-served with an explicit status.
 * - GET /api/v1/geo-governed/collections/:id/items — bounded proxy for
 *   SERVED collections only, with an exact provenance header
 *   (`live-ogc` / `pg-fallback`) and the per-collection property allowlist.
 *
 * Refusals happen BEFORE any upstream call. No PMTiles route or reference is
 * served here (N2 negative). No reader operation is added; `content-serve.ts`,
 * `reader-storage.ts` and `reader-operations.ts` are untouched (D3 negative).
 */

import { Hono } from "hono";
import type { Database } from "../db/client.js";
import { DEFAULT_OGC_BASE_URL } from "../services/geo/ogc-pull.js";
import { getZoneFeatures } from "../services/geo/geo-features.js";
import { sanitizeFeatureProvenance } from "../services/geo/provenance.js";
import {
  GOVERNED_BUSINESS_PILOT_GAP,
  GOVERNED_PILOT_CITY,
  GOVERNED_POLICY_VERSION,
  GOVERNED_SERVED_RECORDS,
  catalogueCollections,
  catalogueCollection,
  parseGovernedFamily,
  type CataloguedCollection,
  type LiveCollectionDescriptor,
  type ServedCollectionRecord,
} from "../services/geo/governed-policy.js";
import { applyZonageAllowlist } from "../services/geo/governed-allowlist.js";
import { assertRegistryTitlesUnique } from "../services/geo/governed-licences.js";
import {
  readServedContractPointer,
  type ServedContractClient,
  type ServedContractEnv,
  type ServedContractPointer,
} from "../services/geo/served-contract-pointer.js";

/** Frozen governed root (P3). Distinct from the public `/api/geo/*` prefix. */
export const GOVERNED_BASE_PATH = "/api/v1/geo-governed";

/** Exact provenance header values served on item responses. */
export const GOVERNANCE_PROVENANCE_LIVE = "live-ogc";
export const GOVERNANCE_PROVENANCE_FALLBACK = "pg-fallback";
export const GOVERNANCE_PROVENANCE_HEADER = "x-geo-provenance";

/** Upper bound of the bounded items proxy (I-1A serves zonage polygons). */
export const GOVERNED_ITEMS_LIMIT_DEFAULT = 200;
export const GOVERNED_ITEMS_LIMIT_MAX = 1000;

/** TTL of the live listing cache (one province-wide request, then cached). */
export const GOVERNED_LISTING_TTL_MS_DEFAULT = 10 * 60_000;

/** TTL of the served-contract pointer cache (P1 status is near-static). */
const POINTER_TTL_MS = 5 * 60_000;

/**
 * Serve one item's properties through the allowlist FIRST, then re-attach
 * the contract-validated provenance envelopes. Composition order matters:
 * `applyZonageAllowlist` drops `proof` / `immo_zone_lot_provenance`
 * (they are not allowlisted fields), so the sanitiser output must be
 * merged back AFTER the allowlist — never nested inside it.
 * Shared with the reader geo service (I-1B): same fields on every path.
 */
export function serveZonageProperties(
  collectionId: string,
  rawProperties: Record<string, unknown>,
  records: readonly ServedCollectionRecord[] = GOVERNED_SERVED_RECORDS,
): Record<string, unknown> {
  const allowed = applyZonageAllowlist(collectionId, rawProperties, records);
  const sanitized = sanitizeFeatureProvenance({ ...rawProperties });
  const out: Record<string, unknown> = { ...allowed };
  if ("proof" in sanitized) out["proof"] = sanitized["proof"];
  if ("immo_zone_lot_provenance" in sanitized) {
    out["immo_zone_lot_provenance"] = sanitized["immo_zone_lot_provenance"];
  }
  return out;
}

export interface GovernedLocalZoneResolver {
  (collectionId: string): Promise<{
    type: string;
    features: Array<{
      type: string;
      geometry: unknown;
      properties: Record<string, unknown>;
    }>;
  } | null>;
}

export interface GeoGovernedDeps {
  /** Database for the pg-fallback path. Absent: live-only, 502 when live fails. */
  db?: Database;
  /** Injectable fetch (tests stay offline — never a real network call). */
  fetchImpl?: typeof fetch;
  /** OGC base URL override (default GEO_OGC_BASE_URL ?? prod default). */
  baseUrl?: string;
  /** Listing cache TTL override (tests). */
  listingTtlMs?: number;
  /** Injectable pg-fallback resolver (default: DB-backed by collection suffix). */
  localZoneResolver?: GovernedLocalZoneResolver;
  /** Env subset naming the P1 read credential (default: process.env). */
  contractEnv?: ServedContractEnv;
  /** Injectable pointer client (absent in I-1A ⇒ `missing source`, by design). */
  contractClient?: ServedContractClient;
}

/** Live listing collection as rendered by the geo OGC API. */
interface OgcListedCollection {
  id?: unknown;
  license?: { title?: unknown } | null;
  rights?: unknown;
}

function toDescriptor(raw: OgcListedCollection): LiveCollectionDescriptor | null {
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  return {
    id: raw.id,
    licenseTitle: raw.license?.title,
    rightsPresent: raw.rights !== null && raw.rights !== undefined,
  };
}

function clampLimit(raw: string | undefined): number {
  if (!raw) return GOVERNED_ITEMS_LIMIT_DEFAULT;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return GOVERNED_ITEMS_LIMIT_DEFAULT;
  return Math.min(parsed, GOVERNED_ITEMS_LIMIT_MAX);
}

export function geoGovernedRoute(deps: GeoGovernedDeps = {}): Hono {
  const app = new Hono();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const listingTtlMs = deps.listingTtlMs ?? GOVERNED_LISTING_TTL_MS_DEFAULT;
  const records: readonly ServedCollectionRecord[] = GOVERNED_SERVED_RECORDS;

  // Fail fast on an ambiguous shipped registry: a duplicated title across ids
  // would otherwise resolve to the first match instead of unknown.
  assertRegistryTitlesUnique();

  const resolveBase = (): string =>
    (
      deps.baseUrl ??
      process.env["GEO_OGC_BASE_URL"] ??
      DEFAULT_OGC_BASE_URL
    ).replace(/\/$/, "");

  const defaultLocalResolver: GovernedLocalZoneResolver = async (collectionId) => {
    if (!deps.db) return null;
    const suffix = collectionId.slice("qc-zonage-".length);
    if (!suffix) return null;
    // The collection suffix is NOT the DB city slug (e.g. the pilot
    // "qc-zonage-gatineau-affectations-territoire" lives under "gatineau"):
    // try the full suffix first, then progressively shorter prefixes, and
    // serve the first stocked city. Fail-closed (null) when none is stocked.
    const parts = suffix.split("-");
    for (let len = parts.length; len >= 1; len -= 1) {
      const citySlug = parts.slice(0, len).join("-");
      const fc = await getZoneFeatures(deps.db, citySlug);
      if (fc.features.length > 0) return fc;
    }
    return null;
  };
  const localZoneResolver = deps.localZoneResolver ?? defaultLocalResolver;

  // ── Live listing cache (single-flight, failures never cached) ────────────
  let listingCache: { expiresAt: number; value: Promise<LiveCollectionDescriptor[]> } | undefined;

  async function fetchListing(): Promise<LiveCollectionDescriptor[]> {
    const url = `${resolveBase()}/collections?f=json&limit=10000`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`listing HTTP ${res.status}`);
    const body = (await res.json()) as { collections?: OgcListedCollection[] };
    const collections = Array.isArray(body.collections) ? body.collections : [];
    const descriptors: LiveCollectionDescriptor[] = [];
    for (const raw of collections) {
      const descriptor = toDescriptor(raw);
      if (descriptor) descriptors.push(descriptor);
    }
    return descriptors;
  }

  function getListing(): Promise<LiveCollectionDescriptor[]> {
    const now = Date.now();
    if (listingCache && listingCache.expiresAt > now) return listingCache.value;
    const value = fetchListing();
    listingCache = { expiresAt: now + listingTtlMs, value };
    void value.catch(() => {
      if (listingCache && Date.now() < listingCache.expiresAt) listingCache = undefined;
    });
    return value;
  }

  // ── P1 pointer cache (near-static status) ────────────────────────────────
  let pointerCache: { expiresAt: number; value: ServedContractPointer } | undefined;

  async function getPointer(): Promise<ServedContractPointer> {
    const now = Date.now();
    if (pointerCache && pointerCache.expiresAt > now) return pointerCache.value;
    const value = await readServedContractPointer({
      env: deps.contractEnv ?? (process.env as ServedContractEnv),
      ...(deps.contractClient ? { client: deps.contractClient } : {}),
    });
    pointerCache = { expiresAt: now + POINTER_TTL_MS, value };
    return value;
  }

  /** Refusal body for a non-served collection (typed, never a 200-empty). */
  function refusalBody(entry: CataloguedCollection): Record<string, unknown> {
    return {
      ok: false,
      error: "geo_governed_not_served",
      collectionId: entry.collectionId,
      status: entry.status,
      ...(entry.reason ? { reason: entry.reason } : {}),
    };
  }

  // ── GET catalog ──────────────────────────────────────────────────────────
  app.get(`${GOVERNED_BASE_PATH}/catalog`, async (c) => {
    let descriptors: LiveCollectionDescriptor[];
    try {
      descriptors = await getListing();
    } catch (err) {
      return c.json(
        {
          ok: false,
          error: "geo_governed_listing_unreachable",
          detail: err instanceof Error ? err.message : String(err),
        },
        502,
      );
    }
    const entries = catalogueCollections(descriptors, records);
    const [pointer] = await Promise.all([getPointer()]);
    return c.json({
      ok: true,
      policyVersion: GOVERNED_POLICY_VERSION,
      pilotCity: GOVERNED_PILOT_CITY,
      businessPilotGap: GOVERNED_BUSINESS_PILOT_GAP,
      served: entries.filter((entry) => entry.status === "served"),
      refused: entries
        .filter((entry) => entry.status !== "served")
        .map((entry) => ({
          collectionId: entry.collectionId,
          status: entry.status,
          ...(entry.reason ? { reason: entry.reason } : {}),
        })),
      contract:
        pointer.status === "ok"
          ? { status: "ok", snapshot_sha256: pointer.snapshotSha256 }
          : { status: "missing source", reason: pointer.reason },
    });
  });

  // ── GET items (bounded proxy, served collections only) ───────────────────
  app.get(`${GOVERNED_BASE_PATH}/collections/:id/items`, async (c) => {
    const id = c.req.param("id");
    const family = parseGovernedFamily(id);
    if (family !== "zonage") {
      // No record can exist outside zonage: refuse BEFORE any upstream call.
      return c.json(
        {
          ok: false,
          error: "geo_governed_not_served",
          collectionId: id,
          status: "not served",
          reason: `family-${family}-deferred-in-i1a`,
        },
        403,
      );
    }
    const record = records.find((r) => r.collectionId === id);
    if (!record) {
      // No dated per-collection record: refuse BEFORE any upstream call with
      // the same status the catalogue reports for record-less zonage
      // (`not covered`), never the licence-unknown status — the live licence
      // is unverifiable without an upstream call, and the record is missing
      // in every case.
      return c.json(
        refusalBody({
          collectionId: id,
          status: "not covered",
          licence: { status: "unknown", reason: "missing-title" },
          rightsPresent: false,
          reason: "no-dated-per-collection-record",
        }),
        403,
      );
    }

    // Served candidate: verify the live licence still matches (cached listing).
    let descriptors: LiveCollectionDescriptor[];
    try {
      descriptors = await getListing();
    } catch {
      // Fail-closed: without the listing the (i) condition is unverifiable.
      return c.json(
        { ok: false, error: "geo_governed_listing_unreachable", collectionId: id },
        502,
      );
    }
    const live = descriptors.find((d) => d.id === id);
    const entry = catalogueCollection(
      live ?? { id, licenseTitle: undefined, rightsPresent: false },
      records,
    );
    if (entry.status !== "served" || !entry.record) {
      return c.json(refusalBody(entry), 403);
    }

    // Bounded passthrough query: limit/bbox/offset only, f=json forced.
    const limit = clampLimit(c.req.query("limit"));
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    for (const name of ["bbox", "offset"] as const) {
      const value = c.req.query(name);
      if (value !== undefined && value !== "") params.set(name, value);
    }
    params.set("f", "json");
    const url = `${resolveBase()}/collections/${encodeURIComponent(id)}/items?${params.toString()}`;
    const pointer = await getPointer();
    const contract =
      pointer.status === "ok"
        ? { status: "ok", snapshot_sha256: pointer.snapshotSha256 }
        : { status: "missing source", reason: pointer.reason };

    let liveRes: Response;
    try {
      liveRes = await fetchImpl(url);
    } catch (err) {
      liveRes = new Response(null, { status: 502 });
      void err;
    }
    if (liveRes.ok) {
      const body = (await liveRes.json()) as {
        features?: Array<{ properties?: Record<string, unknown> }>;
        numberMatched?: number;
        numberReturned?: number;
      };
      const features = Array.isArray(body.features) ? body.features : [];
      const served = features.map((feature) => ({
        ...feature,
        properties: serveZonageProperties(id, {
          ...(feature.properties ?? {}),
        } as Record<string, unknown>, records),
      }));
      c.header(GOVERNANCE_PROVENANCE_HEADER, GOVERNANCE_PROVENANCE_LIVE);
      return c.json({
        type: "FeatureCollection",
        features: served,
        ...(typeof body.numberMatched === "number" ? { numberMatched: body.numberMatched } : {}),
        numberReturned: served.length,
        collectionId: id,
        licenseId: entry.record.licenseId,
        contract,
      });
    }

    // Live failed: pg-fallback from the local store (when wired and stocked).
    // The fallback serves through the SAME allowlist + provenance sanitiser
    // as the live path: banned keys (`adresse`, `code_postal*`,
    // `extrait_brut`) never leave the facade on any path.
    try {
      const local = await localZoneResolver(id);
      if (local && local.features.length > 0) {
        const fallen = local.features.map((feature) => ({
          ...feature,
          properties: serveZonageProperties(id, {
            ...((feature.properties ?? {}) as Record<string, unknown>),
          }, records),
        }));
        const sliced = fallen.slice(0, limit);
        c.header(GOVERNANCE_PROVENANCE_HEADER, GOVERNANCE_PROVENANCE_FALLBACK);
        return c.json({
          type: "FeatureCollection",
          features: sliced,
          numberMatched: local.features.length,
          numberReturned: sliced.length,
          collectionId: id,
          licenseId: entry.record.licenseId,
          contract,
        });
      }
    } catch {
      // Fall through to the honest error below.
    }
    if (liveRes.status === 404) {
      return c.json(
        { ok: false, error: "collection_not_found", collectionId: id },
        404,
      );
    }
    return c.json(
      { ok: false, error: "geo_proxy_error", collectionId: id, status: liveRes.status },
      502,
    );
  });

  return app;
}
