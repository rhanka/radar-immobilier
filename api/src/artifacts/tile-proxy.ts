/**
 * Same-origin basemap tile proxy (lot I-10A, decision pass-wonder).
 *
 * A byte relay: no reprojection, no composition, no server-side image
 * rewrite. The module is intentionally standalone: it takes an injected
 * reader authorizer and content-host gate so I-10B can mount it inside
 * `createReaderContentApp` next to the design-kit route without this file
 * ever importing (or touching) content-serve.ts, reader-storage.ts or
 * reader-operations.ts.
 *
 * Frozen contract (pass-wonder section 4):
 * - Reserved path: GET /__artifacts/tiles/v1/{z}/{x}/{y} (no extension;
 *   the served Content-Type comes from the upstream allow-list). The
 *   fallback-only French/English label overlay lives one segment deeper:
 *   GET /__artifacts/tiles/v1/labels/{z}/{x}/{y}.
 * - Default upstream: Gouvernement du Quebec WMTS Cartes_Images,
 *   layer BDTQ-20K, style default, matrix set
 *   GoogleMapsCompatibleExt2:epsg:3857 (CC-BY 4.0, Donnees Quebec). The
 *   TileMatrix limits below are copied verbatim from the live
 *   GetCapabilities of that layer; any tile outside them is refused
 *   locally with no upstream call.
 * - Fallback upstream: Natural Resources Canada CBMT/CBCT EPSG:3857
 *   (Open Government Licence - Canada): geometry JPEG plus a text-only
 *   PNG overlay composed client-side by the I-4 base.
 * - OSM raster tiles (J1.1, B1) on the sibling path
 *   GET /__artifacts/tiles/v1/osm/{z}/{x}/{y}, z 0..19, with a per-reader
 *   rate limit, an identifying User-Agent, no client IP forwarded and the
 *   OSM attribution kept visible in the page. Geo PMTiles as a basemap
 *   stays rejected and has no entry in the upstream table.
 */
import { Hono, type Context } from "hono";

export const TILE_PATH_PREFIX = "/__artifacts/tiles/v1" as const;
export const TILE_LABELS_SEGMENT = "labels" as const;
/**
 * J1.1 OSM relay path (B1): same-origin replacement for the OSM template
 * baked into the UI bundle. The default path above keeps serving the
 * BDTQ/RNCan upstreams; this sibling path serves OpenStreetMap tiles only.
 */
export const TILE_OSM_PATH_PREFIX = `${TILE_PATH_PREFIX}/osm` as const;

/** Closed upstream identifiers. No other host can ever be fetched. */
export type TileUpstreamId = "quebec-bdtq20k" | "rncan-cbmt" | "osm";

export interface TileUpstream {
  readonly id: TileUpstreamId;
  /** Fixed HTTPS host; the request path is built by a closed template. */
  readonly host: string;
  /** Tile template in public {z}/{x}/{y} order (upstream axis order applied inside). */
  readonly tile: (z: number, x: number, y: number) => string;
  /** Label-overlay template, present only when the upstream ships one. */
  readonly labels?: (z: number, x: number, y: number) => string;
}

const QUEBEC_HOST = "servicesmatriciels.mern.gouv.qc.ca";
const RNCAN_HOST = "maps-cartes.services.geo.ca";

export const TILE_UPSTREAMS: Record<TileUpstreamId, TileUpstream> = {
  "quebec-bdtq20k": {
    id: "quebec-bdtq20k",
    host: QUEBEC_HOST,
    tile: (z, x, y) =>
      `https://${QUEBEC_HOST}/erdas-iws/ogc/wmts/Cartes_Images/BDTQ-20K/default/` +
      `GoogleMapsCompatibleExt2:epsg:3857/${z}/${y}/${x}.jpg`,
  },
  "rncan-cbmt": {
    id: "rncan-cbmt",
    host: RNCAN_HOST,
    tile: (z, x, y) =>
      `https://${RNCAN_HOST}/server2_serveur2/rest/services/BaseMaps/` +
      `CBMT_CBCT_GEOM_3857/MapServer/tile/${z}/${y}/${x}`,
    labels: (z, x, y) =>
      `https://${RNCAN_HOST}/server2_serveur2/rest/services/BaseMaps/` +
      `CBMT_TXT_3857/MapServer/tile/${z}/${y}/${x}`,
  },
  // J1.1 OSM upstream (B1): standard raster tiles in public {z}/{x}/{y}
  // order. Served only on the OSM relay path with a per-reader rate limit;
  // the default path never touches this host.
  "osm": {
    id: "osm",
    host: "tile.openstreetmap.org",
    tile: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  },
};

export const TILE_UPSTREAM_ORDER: readonly TileUpstreamId[] =
  ["quebec-bdtq20k", "rncan-cbmt"];

/** Zoom range served by the proxy (pass-wonder section 4.3). */
export const TILE_MIN_ZOOM = 5;
export const TILE_MAX_ZOOM = 18;
/** Zoom range served on the OSM relay path (OSM tile usage policy: z <= 19). */
export const TILE_OSM_MIN_ZOOM = 0;
export const TILE_OSM_MAX_ZOOM = 19;

/**
 * Quebec product footprint per zoom, copied from the BDTQ-20K
 * TileMatrixSetLimits for GoogleMapsCompatibleExt2:epsg:3857
 * (WMTS TileMatrix == z, TileRow == y, TileCol == x). A tile outside
 * these bounds is answered 404 locally without any upstream call.
 */
export interface TileEmprise {
  readonly minRow: number;
  readonly maxRow: number;
  readonly minCol: number;
  readonly maxCol: number;
}

export const TILE_EMPRISE_3857: Readonly<Record<number, TileEmprise>> = {
  5: { minRow: 10, maxRow: 11, minCol: 8, maxCol: 11 },
  6: { minRow: 20, maxRow: 23, minCol: 17, maxCol: 22 },
  7: { minRow: 40, maxRow: 46, minCol: 34, maxCol: 44 },
  8: { minRow: 81, maxRow: 92, minCol: 69, maxCol: 88 },
  9: { minRow: 162, maxRow: 185, minCol: 139, maxCol: 176 },
  10: { minRow: 324, maxRow: 370, minCol: 279, maxCol: 352 },
  11: { minRow: 648, maxRow: 741, minCol: 559, maxCol: 704 },
  12: { minRow: 1297, maxRow: 1482, minCol: 1119, maxCol: 1408 },
  13: { minRow: 2595, maxRow: 2964, minCol: 2238, maxCol: 2817 },
  14: { minRow: 5191, maxRow: 5929, minCol: 4476, maxCol: 5635 },
  15: { minRow: 10382, maxRow: 11858, minCol: 8953, maxCol: 11271 },
  16: { minRow: 20764, maxRow: 23716, minCol: 17907, maxCol: 22543 },
  17: { minRow: 41529, maxRow: 47433, minCol: 35815, maxCol: 45087 },
  18: { minRow: 83058, maxRow: 94866, minCol: 71631, maxCol: 90174 },
};

/** Shared server cache bounds (pass-wonder section 4.2). */
export const TILE_CACHE_MAX_BYTES = 256 * 1024 * 1024;
export const TILE_CACHE_MAX_ENTRIES = 20000;
/** A single tile larger than this is relayed as 502 and never cached. */
export const TILE_MAX_TILE_BYTES = 1024 * 1024;
/** One upstream attempt, no burst retry; the fallback is the second try. */
export const TILE_UPSTREAM_TIMEOUT_MS = 5000;
/** Negative cache for tiles missing on both upstreams. */
export const TILE_NEGATIVE_TTL_MS = 5 * 60 * 1000;
export const TILE_NEGATIVE_MAX_ENTRIES = 1000;
/** Upstream freshness is honored (both upstreams serve max-age=86400) and capped here. */
export const TILE_FRESHNESS_CAP_MS = 7 * 24 * 60 * 60 * 1000;
export const TILE_DEFAULT_FRESHNESS_MS = 24 * 60 * 60 * 1000;
/** Browser response after the global no-store middleware is rewritten by the mount. */
export const TILE_CLIENT_MAX_AGE_SECONDS = 86400;

export const TILE_SERVICE_USER_AGENT =
  "immo-tile-proxy/1 (+https://immo.sent-tech.ca)" as const;
export const TILE_UPSTREAM_ACCEPT = "image/jpeg,image/png" as const;

const TILE_ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png"]);

/** Attribution strings exposed for the I-4 map base (pass-wonder section 4.4). */
export interface TileAttribution {
  readonly text: string;
  readonly licenseUrl: string;
  readonly upstream: TileUpstreamId;
}

export const TILE_ATTRIBUTION_DEFAULT: TileAttribution = {
  text: "© Gouvernement du Québec — Cartes topographiques 1/20 000 (CC-BY 4.0)",
  licenseUrl: "https://www.donneesquebec.ca/licence/",
  upstream: "quebec-bdtq20k",
};

export const TILE_ATTRIBUTION_FALLBACK: TileAttribution = {
  text: "© Sa Majesté le Roi du chef du Canada, représenté par le ministre de Ressources naturelles Canada",
  licenseUrl: "https://ouvert.canada.ca/fr/licence-du-gouvernement-ouvert-canada",
  upstream: "rncan-cbmt",
};

/** Attribution the page must keep visible while the OSM relay is active. */
export const TILE_ATTRIBUTION_OSM: TileAttribution = {
  text: "© OpenStreetMap contributors",
  licenseUrl: "https://www.openstreetmap.org/copyright",
  upstream: "osm",
};

export interface TileProxyMetrics {
  readonly hits: number;
  readonly misses: number;
  readonly negativeHits: number;
  readonly upstreamCalls: number;
  readonly upstreamBytes: number;
  readonly evictions: number;
  readonly entries: number;
  readonly bytes: number;
}

export interface TileProxyEvent {
  readonly upstream: TileUpstreamId;
  readonly layer: "tile" | "labels";
  readonly z: number;
  readonly x: number;
  readonly y: number;
  /** Deliberately free of reader, session, IP and grant fields. */
  readonly cache: "hit" | "miss" | "negative";
  readonly status: number;
  readonly bytes: number;
  readonly durationMs: number;
}

interface TileCacheEntry {
  body: Uint8Array<ArrayBuffer>;
  contentType: string;
  etag: string | null;
  storedAt: number;
  maxAgeMs: number;
}

export interface TileProxyOptions {
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly onEvent?: (event: TileProxyEvent) => void;
  readonly maxBytes?: number;
  readonly maxEntries?: number;
  readonly negativeMaxEntries?: number;
  readonly negativeTtlMs?: number;
  readonly upstreamTimeoutMs?: number;
}

function parseMaxAgeMs(cacheControl: string | null): number {
  const match = cacheControl ? /max-age=(\d+)/.exec(cacheControl) : null;
  const seconds = match ? Number(match[1]) : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return TILE_DEFAULT_FRESHNESS_MS;
  return Math.min(seconds * 1000, TILE_FRESHNESS_CAP_MS);
}

function isFresh(entry: TileCacheEntry, now: number): boolean {
  return entry.storedAt + entry.maxAgeMs > now;
}

export function createTileProxy(options: TileProxyOptions = {}): TileProxy {
  return new TileProxy(options);
}

export class TileProxy {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly onEvent: ((event: TileProxyEvent) => void) | undefined;
  private readonly maxBytes: number;
  private readonly maxEntries: number;
  private readonly negativeMaxEntries: number;
  private readonly negativeTtlMs: number;
  private readonly upstreamTimeoutMs: number;
  private readonly entries = new Map<string, TileCacheEntry>();
  private readonly negative = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<FetchOutcome>>();
  private bytes = 0;
  private hits = 0;
  private misses = 0;
  private negativeHits = 0;
  private upstreamCalls = 0;
  private upstreamBytes = 0;
  private evictions = 0;

  constructor(options: TileProxyOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.onEvent = options.onEvent;
    this.maxBytes = options.maxBytes ?? TILE_CACHE_MAX_BYTES;
    this.maxEntries = options.maxEntries ?? TILE_CACHE_MAX_ENTRIES;
    this.negativeMaxEntries = options.negativeMaxEntries ?? TILE_NEGATIVE_MAX_ENTRIES;
    this.negativeTtlMs = options.negativeTtlMs ?? TILE_NEGATIVE_TTL_MS;
    this.upstreamTimeoutMs = options.upstreamTimeoutMs ?? TILE_UPSTREAM_TIMEOUT_MS;
  }

  metrics(): TileProxyMetrics {
    return {
      hits: this.hits,
      misses: this.misses,
      negativeHits: this.negativeHits,
      upstreamCalls: this.upstreamCalls,
      upstreamBytes: this.upstreamBytes,
      evictions: this.evictions,
      entries: this.entries.size,
      bytes: this.bytes,
    };
  }

  clear(): void {
    this.entries.clear();
    this.negative.clear();
    this.inFlight.clear();
    this.bytes = 0;
  }

  private cacheKey(upstream: TileUpstreamId, layer: "tile" | "labels", z: number, x: number, y: number): string {
    return `${upstream}:${layer}:${z}/${x}/${y}`;
  }

  private store(key: string, entry: TileCacheEntry): void {
    const previous = this.entries.get(key);
    if (previous) this.bytes -= previous.body.byteLength;
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.bytes += entry.body.byteLength;
    while ((this.bytes > this.maxBytes || this.entries.size > this.maxEntries) && this.entries.size > 0) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      const removed = this.entries.get(oldest.value);
      this.entries.delete(oldest.value);
      if (removed) this.bytes -= removed.body.byteLength;
      this.evictions += 1;
    }
  }

  private rememberNegative(key: string, now: number): void {
    if (this.negative.has(key)) this.negative.delete(key);
    this.negative.set(key, now + this.negativeTtlMs);
    while (this.negative.size > this.negativeMaxEntries) {
      const oldest = this.negative.keys().next();
      if (oldest.done) break;
      this.negative.delete(oldest.value);
    }
  }

  private async fetchUpstream(url: string, etag: string | null): Promise<FetchOutcome> {
    this.upstreamCalls += 1;
    const headers: Record<string, string> = {
      accept: TILE_UPSTREAM_ACCEPT,
      "user-agent": TILE_SERVICE_USER_AGENT,
    };
    if (etag) headers["if-none-match"] = etag;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(this.upstreamTimeoutMs),
      });
    } catch {
      return { kind: "error" };
    }
    if (response.status === 304) return { kind: "not-modified",
      maxAgeMs: parseMaxAgeMs(response.headers.get("cache-control")) };
    if (response.status === 404) return { kind: "not-found" };
    if (response.status !== 200) return { kind: "error" };
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!TILE_ALLOWED_CONTENT_TYPES.has(contentType)) return { kind: "error" };
    const body = await readCapped(response, TILE_MAX_TILE_BYTES);
    if (!body) return { kind: "error" };
    const png = contentType === "image/png";
    if (png ? !(body[0] === 0x89 && body[1] === 0x50) : !(body[0] === 0xff && body[1] === 0xd8)) {
      return { kind: "error" };
    }
    this.upstreamBytes += body.byteLength;
    return {
      kind: "ok",
      body,
      contentType,
      etag: response.headers.get("etag"),
      maxAgeMs: parseMaxAgeMs(response.headers.get("cache-control")),
    };
  }

  private inFlightFetch(key: string, url: string, etag: string | null): Promise<FetchOutcome> {
    const running = this.inFlight.get(key);
    if (running) return running;
    const outcome = this.fetchUpstream(url, etag).finally(() => {
      if (this.inFlight.get(key) === outcome) this.inFlight.delete(key);
    });
    this.inFlight.set(key, outcome);
    return outcome;
  }

  /**
   * Serve one tile. With `onlyUpstream` the proxy tries that single
   * upstream (OSM relay path) instead of the default ordered pair; the
   * negative entry is then namespaced so a fixed-upstream 404 never
   * poisons the default path, and conversely.
   */
  async serve(layer: "tile" | "labels", z: number, x: number, y: number,
    onlyUpstream?: TileUpstreamId): Promise<TileResponse> {
    const started = this.now();
    const order = onlyUpstream
      ? [onlyUpstream]
      : layer === "labels" ? (["rncan-cbmt"] as const) : TILE_UPSTREAM_ORDER;
    const key = onlyUpstream ? `${onlyUpstream}:${layer}:${z}/${x}/${y}` : `${layer}:${z}/${x}/${y}`;
    const negativeUntil = this.negative.get(key);
    if (negativeUntil !== undefined && negativeUntil > started) {
      this.negativeHits += 1;
      return tileJson(404, { error: "not_found" });
    }
    if (negativeUntil !== undefined) this.negative.delete(key);
    let sawNotFound = false;
    for (const upstreamId of order) {
      const upstream = TILE_UPSTREAMS[upstreamId];
      const template = layer === "labels" ? upstream.labels : upstream.tile;
      if (!template) continue;
      const entryKey = this.cacheKey(upstreamId, layer, z, x, y);
      const cached = this.entries.get(entryKey);
      if (cached && isFresh(cached, started)) {
        this.entries.delete(entryKey);
        this.entries.set(entryKey, cached);
        this.hits += 1;
        this.onEvent?.({ upstream: upstreamId, layer, z, x, y, cache: "hit",
          status: 200, bytes: cached.body.byteLength, durationMs: this.now() - started });
        return tileBody(cached);
      }
      this.misses += 1;
      const outcome = await this.inFlightFetch(entryKey, template(z, x, y), cached?.etag ?? null);
      if (outcome.kind === "not-modified" && cached) {
        cached.storedAt = this.now();
        cached.maxAgeMs = outcome.maxAgeMs;
        this.hits += 1;
        this.onEvent?.({ upstream: upstreamId, layer, z, x, y, cache: "hit",
          status: 200, bytes: cached.body.byteLength, durationMs: this.now() - started });
        return tileBody(cached);
      }
      if (outcome.kind === "ok") {
        const fresh: TileCacheEntry = { body: outcome.body, contentType: outcome.contentType,
          etag: outcome.etag, storedAt: this.now(), maxAgeMs: outcome.maxAgeMs };
        this.store(entryKey, fresh);
        this.onEvent?.({ upstream: upstreamId, layer, z, x, y, cache: "miss",
          status: 200, bytes: fresh.body.byteLength, durationMs: this.now() - started });
        return tileBody(fresh);
      }
      if (outcome.kind === "not-found") {
        sawNotFound = true;
        continue;
      }
    }
    // A tile missing on every tried upstream is cached briefly so it does
    // not hammer the public services. Any upstream error without a usable
    // tile stays a typed 502 with no negative entry: the miss may be
    // transient and must be retried on the next viewport.
    if (sawNotFound) {
      this.rememberNegative(key, this.now());
      this.onEvent?.({ upstream: order[order.length - 1] ?? "quebec-bdtq20k", layer, z, x, y,
        cache: "negative", status: 404, bytes: 0, durationMs: this.now() - started });
      return tileJson(404, { error: "not_found" });
    }
    this.onEvent?.({ upstream: order[order.length - 1] ?? "quebec-bdtq20k", layer, z, x, y,
      cache: "miss", status: 502, bytes: 0, durationMs: this.now() - started });
    return tileJson(502, { error: "tile_unavailable" });
  }
}

type FetchOutcome =
  | { kind: "ok"; body: Uint8Array<ArrayBuffer>; contentType: string; etag: string | null; maxAgeMs: number }
  | { kind: "not-modified"; maxAgeMs: number }
  | { kind: "not-found" }
  | { kind: "error" };

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(new Uint8Array(value));
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export interface TileResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: Uint8Array<ArrayBuffer> | null;
  readonly json: unknown | null;
}

function tileBody(entry: TileCacheEntry): TileResponse {
  const headers: Record<string, string> = {
    "content-type": entry.contentType,
    "cache-control": `private, max-age=${TILE_CLIENT_MAX_AGE_SECONDS}`,
    "x-content-type-options": "nosniff",
  };
  if (entry.etag) headers["etag"] = entry.etag;
  return { status: 200, headers, body: entry.body, json: null };
}

function tileJson(status: number, json: unknown): TileResponse {
  return { status, headers: { "content-type": "application/json; charset=utf-8" }, body: null, json };
}

/** Parse result for the reserved tile path, before any upstream call. */
export type TilePathParse =
  | { kind: "ok"; layer: "tile" | "labels"; z: number; x: number; y: number }
  | { kind: "malformed" }
  | { kind: "out-of-range" };

/**
 * Strict validation of the raw request target (query already stripped):
 * decimal digits only, so any %, backslash, dot, letter or suffix fails
 * closed before any numeric check, and both before any upstream call.
 */
export function parseTilePath(rawTarget: string): TilePathParse {
  if (!rawTarget.startsWith(TILE_PATH_PREFIX + "/")) return { kind: "malformed" };
  const rest = rawTarget.slice(TILE_PATH_PREFIX.length + 1);
  const segments = rest.split("/");
  let layer: "tile" | "labels" = "tile";
  let coords = segments;
  if (segments[0] === TILE_LABELS_SEGMENT) {
    layer = "labels";
    coords = segments.slice(1);
  }
  if (coords.length !== 3 || coords.some((segment) => typeof segment !== "string" || !/^[0-9]+$/.test(segment))) {
    return { kind: "malformed" };
  }
  const z = Number(coords[0] as string);
  const x = Number(coords[1] as string);
  const y = Number(coords[2] as string);
  if (!Number.isSafeInteger(z) || !Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
    return { kind: "malformed" };
  }
  if (z < TILE_MIN_ZOOM || z > TILE_MAX_ZOOM || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
    return { kind: "out-of-range" };
  }
  const emprise = TILE_EMPRISE_3857[z];
  if (!emprise || y < emprise.minRow || y > emprise.maxRow || x < emprise.minCol || x > emprise.maxCol) {
    return { kind: "out-of-range" };
  }
  return { kind: "ok", layer, z, x, y };
}

/** Raw request target with the query stripped and ignored (never relayed). */
export function rawTargetWithoutQuery(requestUrl: string): string {
  const afterScheme = requestUrl.indexOf("://");
  const pathStart = afterScheme === -1 ? 0 : requestUrl.indexOf("/", afterScheme + 3);
  const target = pathStart === -1 ? "/" : requestUrl.slice(pathStart);
  const queryStart = target.indexOf("?");
  return queryStart === -1 ? target : target.slice(0, queryStart);
}

/**
 * Strict validation of the OSM relay target (query already stripped):
 * decimal digits only, zoom bounded by the OSM tile usage policy
 * (TILE_OSM_MIN_ZOOM..TILE_OSM_MAX_ZOOM), one tile per z worldwide.
 */
export function parseOsmTilePath(rawTarget: string): TilePathParse {
  if (!rawTarget.startsWith(TILE_OSM_PATH_PREFIX + "/")) return { kind: "malformed" };
  const coords = rawTarget.slice(TILE_OSM_PATH_PREFIX.length + 1).split("/");
  if (coords.length !== 3 || coords.some((segment) => typeof segment !== "string" || !/^[0-9]+$/.test(segment))) {
    return { kind: "malformed" };
  }
  const z = Number(coords[0] as string);
  const x = Number(coords[1] as string);
  const y = Number(coords[2] as string);
  if (!Number.isSafeInteger(z) || !Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
    return { kind: "malformed" };
  }
  if (z < TILE_OSM_MIN_ZOOM || z > TILE_OSM_MAX_ZOOM || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
    return { kind: "out-of-range" };
  }
  return { kind: "ok", layer: "tile", z, x, y };
}

/** Per-reader abuse guard on the OSM relay path (OSM tile usage policy). */
export interface TileRateLimit {
  /** Sliding window in milliseconds. */
  readonly windowMs: number;
  /** Max relayed requests per reader key per window. */
  readonly maxRequests: number;
}

/** Sustains interactive panning while bounding bulk scraping per reader. */
export const TILE_OSM_RATE_LIMIT_DEFAULT: TileRateLimit = {
  windowMs: 60_000,
  maxRequests: 300,
};

export interface TileProxyMount {
  /** Sealed reader session check (authorized(c, true) at the I-10B mount). */
  readonly authorize: (c: Context) => Promise<boolean>;
  /** Content-origin check (parseContentHost(...) !== other at the mount). */
  readonly isContentHost: (c: Context) => boolean;
  readonly proxy?: TileProxy;
  readonly proxyOptions?: TileProxyOptions;
  /** OSM relay abuse guard; absent leaves the OSM path unthrottled (tests). */
  readonly osmRateLimit?: TileRateLimit;
  /** Reader key for the OSM guard (readerSub at the content mount). */
  readonly rateLimitKey?: (c: Context) => string | null;
  /** Clock for the OSM guard; defaults to Date.now. */
  readonly now?: () => number;
}

/**
 * Test app and future I-10B route body: method, host and session gates run
 * before path validation, and every refusal happens with zero upstream
 * calls. The mount (I-10B) rewrites Cache-Control after the global
 * no-store middleware; the 200 body below already carries the private
 * value as the single source of truth.
 */
export function createTileProxyApp(mount: TileProxyMount): Hono {
  const app = new Hono();
  const proxy = mount.proxy ?? new TileProxy(mount.proxyOptions ?? {});
  const clock = mount.now ?? Date.now;
  // Sliding-window timestamps per reader key for the OSM relay guard.
  const osmHits = new Map<string, number[]>();

  function answer(c: Context, proxyResponse: TileResponse): Response | Promise<Response> {
    if (proxyResponse.json !== null) {
      return c.json(proxyResponse.json, proxyResponse.status as 404 | 429 | 502);
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(proxyResponse.headers)) headers.set(name, value);
    return new Response(proxyResponse.body, { status: proxyResponse.status, headers });
  }

  /** Per-reader OSM guard; refuses 429 with Retry-After before any upstream call. */
  function osmAllowed(c: Context): Response | null {
    const limit = mount.osmRateLimit;
    if (!limit) return null;
    const key = mount.rateLimitKey?.(c) ?? null;
    if (key === null) return null;
    const now = clock();
    const windowStart = now - limit.windowMs;
    const hits = (osmHits.get(key) ?? []).filter((at) => at > windowStart);
    if (hits.length >= limit.maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((hits[0]! + limit.windowMs - now) / 1000));
      c.header("Retry-After", String(retryAfter));
      return c.json({ error: "rate_limited" }, 429);
    }
    hits.push(now);
    osmHits.set(key, hits);
    return null;
  }

  // OSM relay (J1.1): registered before the generic route so the sibling
  // prefix is not swallowed by the frozen default path.
  app.all(`${TILE_OSM_PATH_PREFIX}/*`, async (c) => {
    if (c.req.method !== "GET") return c.json({ error: "method_not_allowed" }, 405);
    if (!mount.isContentHost(c)) return c.json({ error: "not_found" }, 404);
    if (!(await mount.authorize(c))) return c.json({ error: "unauthenticated" }, 401);
    const parsed = parseOsmTilePath(rawTargetWithoutQuery(c.req.url));
    if (parsed.kind === "malformed") return c.json({ error: "invalid_tile" }, 400);
    if (parsed.kind === "out-of-range") return c.json({ error: "not_found" }, 404);
    const limited = osmAllowed(c);
    if (limited) return limited;
    return answer(c, await proxy.serve("tile", parsed.z, parsed.x, parsed.y, "osm"));
  });

  app.all(`${TILE_PATH_PREFIX}/*`, async (c) => {
    if (c.req.method !== "GET") return c.json({ error: "method_not_allowed" }, 405);
    if (!mount.isContentHost(c)) return c.json({ error: "not_found" }, 404);
    if (!(await mount.authorize(c))) return c.json({ error: "unauthenticated" }, 401);
    const parsed = parseTilePath(rawTargetWithoutQuery(c.req.url));
    if (parsed.kind === "malformed") return c.json({ error: "invalid_tile" }, 400);
    if (parsed.kind === "out-of-range") return c.json({ error: "not_found" }, 404);
    return answer(c, await proxy.serve(parsed.layer, parsed.z, parsed.x, parsed.y));
  });
  return app;
}
