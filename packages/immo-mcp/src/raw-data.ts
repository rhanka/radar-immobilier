/**
 * Raw-data seam for the ad hoc representation tools (zones/lots GeoJSON,
 * grille de zonage PDF, PV source PDF).
 *
 * Same pattern as `data-source.ts` (interface + mock impl + http impl +
 * env factory), but a SEPARATE seam on purpose: the v0 `ImmoDataSource` is
 * mock-only in production (its HttpDataSource is `not_wired_yet`), while
 * these raw tools must reach the REAL radar API in-cluster without changing
 * the v0 tools' behaviour. Selection is keyed off `RADAR_API_BASE_URL`
 * alone: set → HTTP against the radar API; unset → deterministic mocks.
 *
 * SIZE BOUNDS (the whole point of this seam): GeoJSON per city can exceed
 * 15 000 lots. Every FeatureCollection answer is bounded by `limit`
 * (default 500, hard max 2000) and beyond the default a `bbox` is REQUIRED.
 * Truncation is always reported (`numberMatched`/`numberReturned`/
 * `truncated`) so the caller can narrow the bbox instead of guessing.
 *
 * Data served here is PUBLIC by construction (zonage/lots publics, PV =
 * documents municipaux publics — cf. api/src/routes/geo-collections.ts
 * "Loi 25" note). No PII transits through these tools.
 */

import {
  MOCK_DOCUMENTS,
  MOCK_LOT_FEATURES,
  MOCK_ZONE_FEATURES,
  type MockGeoFeature,
} from "./mocks.js";

// ── Bounds (documented in the tool descriptions — they guide claude.ai) ────
/** Default page size when the caller does not pass `limit`. */
export const RAW_GEOJSON_DEFAULT_LIMIT = 500;
/** Hard cap on `limit` (with bbox). Beyond that: paginate by bbox. */
export const RAW_GEOJSON_MAX_LIMIT = 2000;
/** Over-fetch factor when lot filters are applied client-side (see below). */
const LOT_FILTER_OVERFETCH = 4;
/** Cap on the upstream fetch when over-fetching for filters. */
const LOT_FILTER_FETCH_CAP = 4000;
/** Upstream page size used to look a single zone up (mirrors the api's zone-index pull). */
const ZONE_LOOKUP_LIMIT = 10000;

// ── Public shapes ───────────────────────────────────────────────────────────

/** [minLon, minLat, maxLon, maxLat] (WGS84), as in OGC API Features. */
export type Bbox = [number, number, number, number];

export interface GeoFeature {
  type: "Feature";
  geometry: unknown;
  properties: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RawFeatureCollectionResult {
  city: string;
  collectionId: string;
  /** Bounded GeoJSON — hand this to any GeoJSON consumer as-is. */
  featureCollection: { type: "FeatureCollection"; features: GeoFeature[] };
  numberReturned: number;
  /** Total matched upstream when known (store local / OGC), null otherwise. */
  numberMatched: number | null;
  /** true when more features matched than were returned — narrow the bbox. */
  truncated: boolean;
  note?: string;
}

export interface GetZonesGeojsonArgs {
  city: string;
  bbox?: Bbox | undefined;
  limit: number;
}

export interface GetLotsGeojsonArgs extends GetZonesGeojsonArgs {
  /** Keep only lots with the server-derived flag multifamilial4plus === true. */
  only4Plus?: boolean | undefined;
  /** Keep only lots with superficieM2 >= this value. */
  superficieMinM2?: number | undefined;
}

export interface GetGrillePdfArgs {
  city: string;
  zone: string;
}

export interface GrillePdfResult {
  found: boolean;
  city: string;
  /** Zone code as requested (normalised for the lookup). */
  zone: string;
  /** Zone code as carried by the source, when the zone was found. */
  zoneCode?: string;
  /** Public grille de zonage PDF URL, null when the source does not carry one. */
  grillePdfUrl?: string | null;
  note?: string;
}

export interface GetPvPdfArgs {
  rawRef: string;
}

export interface PvPdfResult {
  found: boolean;
  rawRef: string;
  /** Served URL of the PDF (proof-viewer route `/api/documents/raw`). */
  url?: string;
  contentType?: string;
  city?: string;
  publishedAt?: string;
  title?: string;
  note?: string;
}

export interface GetReglementProvenanceArgs {
  city: string;
  /**
   * Code de zone — ACCEPTÉ mais no-op pour la provenance : geo stampe les 8
   * champs MUNI-UNIFORMES (identiques sur chaque feature de la grille). Réservé
   * au lien events (tool #2 `query_zoning_events`).
   */
  zone?: string | undefined;
}

/**
 * Provenance du règlement de zonage servie par geo (`qc-zonage-norms-<slug>`,
 * feature-level, muni-uniforme). Passthrough VERBATIM du registre curé : champ
 * absent = `null`, JAMAIS deviné/dérivé. Le breadcrumb interne `_source_url`
 * n'est JAMAIS lu ni exposé — seul `reglement_url` est l'URL publique.
 */
export interface ReglementProvenanceResult {
  found: boolean;
  city: string;
  reglement_url: string | null;
  reglement_numero: string | null;
  reglement_millesime: string | null;
  reglement_page_source: string | null;
  reglement_ancien_numero: string | null;
  reglement_ancien_millesime: string | null;
  reglement_ancien_source: string | null;
  has_ancien: boolean | null;
  note?: string;
}

/**
 * Lit les 8 champs de provenance d'une feature `qc-zonage-norms`, VERBATIM-or-null
 * (anti-invention : absent/vide → `null`, jamais dérivé ; `_source_url` jamais lu ni
 * exposé — seul `reglement_url` est public).
 */
export function reglementProvenanceFromFeature(
  city: string,
  props: Record<string, unknown>,
): ReglementProvenanceResult {
  const str = (key: string): string | null => {
    const v = props[key];
    return typeof v === "string" && v.trim().length > 0 ? v : null;
  };
  return {
    found: true,
    city,
    reglement_url: str("reglement_url"),
    reglement_numero: str("reglement_numero"),
    reglement_millesime: str("reglement_millesime"),
    reglement_page_source: str("reglement_page_source"),
    reglement_ancien_numero: str("reglement_ancien_numero"),
    reglement_ancien_millesime: str("reglement_ancien_millesime"),
    reglement_ancien_source: str("reglement_ancien_source"),
    has_ancien:
      typeof props["has_ancien"] === "boolean" ? (props["has_ancien"] as boolean) : null,
  };
}

/** Provenance « non servie » (grille de normes absente) — tous champs null. */
export function notFoundReglementProvenance(city: string, note: string): ReglementProvenanceResult {
  return {
    found: false,
    city,
    reglement_url: null,
    reglement_numero: null,
    reglement_millesime: null,
    reglement_page_source: null,
    reglement_ancien_numero: null,
    reglement_ancien_millesime: null,
    reglement_ancien_source: null,
    has_ancien: null,
    note,
  };
}

/** Contract of the raw-data provider behind the representation tools. */
export interface RawDataSource {
  readonly mode: "mock" | "http";
  getZonesGeojson(args: GetZonesGeojsonArgs): Promise<RawFeatureCollectionResult>;
  getLotsGeojson(args: GetLotsGeojsonArgs): Promise<RawFeatureCollectionResult>;
  getGrillePdf(args: GetGrillePdfArgs): Promise<GrillePdfResult>;
  getPvPdf(args: GetPvPdfArgs): Promise<PvPdfResult>;
  getReglementProvenance(args: GetReglementProvenanceArgs): Promise<ReglementProvenanceResult>;
}

// ── Shared pure helpers (used by BOTH impls, so tests cover the real path) ──

/** City input → collection slug (lowercase, accents stripped, spaces → "-"). */
export function citySlug(city: string): string {
  return city
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-");
}

/**
 * Zone code normalisation — MIRROR of the api's
 * `api/src/services/geo/extract-refs.ts#normalizeZoneCode` (uppercase,
 * em/en-dash → "-", parenthesised suffix removed, whitespace stripped).
 * Kept in sync manually: immo-mcp does not depend on the api workspace.
 */
export function normalizeZoneCode(raw: unknown): string {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[–—]/g, "-")
    .replace(/\s*\([A-Z0-9]{2,8}\)\s*/g, "")
    .replace(/\s+/g, "");
}

function firstString(candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() !== "") return c;
  }
  return null;
}

/**
 * Case-insensitive property lookup by alias priority: for each alias (already
 * lowercase) take the first prop whose LOWERCASED key equals it. Needed on the
 * LIVE OGC path: real sources mix spellings per city (measured on
 * qc-zonage-longueuil live: `Zonage` + `URL_Grille` — neither is an exact
 * match of the canonical spellings below).
 */
function firstByAlias(
  props: Record<string, unknown>,
  aliases: readonly string[],
): string | null {
  const byLowerKey = new Map<string, unknown>();
  for (const [key, value] of Object.entries(props)) {
    const lower = key.toLowerCase();
    if (!byLowerKey.has(lower)) byLowerKey.set(lower, value);
  }
  return firstString(aliases.map((a) => byLowerKey.get(a)));
}

/**
 * Zone-code / grille-URL property fallbacks — alias sets MIRRORED from the
 * api's `lot-zone-enrichment.ts#buildZoneIndex` lists (store PG `zoneCode`
 * first, then the live OGC source spellings), deduplicated case-insensitively
 * (see firstByAlias).
 */
export function zoneCodeOf(props: Record<string, unknown>): string | null {
  return firstByAlias(props, [
    "zonecode",
    "zone_code",
    "num_zone",
    "no_zonage",
    "code_zone",
    "zone",
    "zonage",
  ]);
}

export function grillePdfUrlOf(props: Record<string, unknown>): string | null {
  return firstByAlias(props, ["grillepdfurl", "grille_pdf_url", "url_grille"]);
}

/** Recursive bbox of any GeoJSON coordinates array. null when no position found. */
function coordsBbox(coords: unknown, acc: number[] | null = null): number[] | null {
  if (!Array.isArray(coords)) return acc;
  if (
    coords.length >= 2 &&
    typeof coords[0] === "number" &&
    typeof coords[1] === "number"
  ) {
    const [lon, lat] = coords as [number, number];
    if (!acc) return [lon, lat, lon, lat];
    acc[0] = Math.min(acc[0]!, lon);
    acc[1] = Math.min(acc[1]!, lat);
    acc[2] = Math.max(acc[2]!, lon);
    acc[3] = Math.max(acc[3]!, lat);
    return acc;
  }
  let out = acc;
  for (const child of coords) out = coordsBbox(child, out);
  return out;
}

function featureBbox(feature: GeoFeature): Bbox | null {
  const geometry = feature.geometry as { coordinates?: unknown } | null;
  const box = coordsBbox(geometry?.coordinates ?? null);
  return box && box.length === 4 ? (box as Bbox) : null;
}

/**
 * DEFENSIVE client-side bbox filter (bbox-overlap on the feature's own bbox).
 * Needed because the api route's LOCAL-STORE path only honours `limit` and
 * ignores `bbox` (geo-collections.ts `applyLimit`); only the proxy path
 * forwards bbox upstream. Features without derivable bbox are kept (honest:
 * we never silently drop data we cannot judge).
 */
export function filterByBbox(features: GeoFeature[], bbox: Bbox | undefined): GeoFeature[] {
  if (!bbox) return features;
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return features.filter((f) => {
    const b = featureBbox(f);
    if (!b) return true;
    return b[0] <= maxLon && b[2] >= minLon && b[1] <= maxLat && b[3] >= minLat;
  });
}

/** Throws when bbox is malformed (order / length checked at the tool layer too). */
export function assertValidBbox(bbox: Bbox): void {
  if (bbox.length !== 4 || bbox.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
    throw new Error("invalid_bbox: attendu [minLon, minLat, maxLon, maxLat] numériques");
  }
  if (bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) {
    throw new Error("invalid_bbox: min doit être < max ([minLon, minLat, maxLon, maxLat])");
  }
}

interface LotFilters {
  only4Plus?: boolean | undefined;
  superficieMinM2?: number | undefined;
}

/** Lot filters over the SERVER-ENRICHED properties (contract in geo-collections.ts). */
export function filterLots(features: GeoFeature[], filters: LotFilters): GeoFeature[] {
  let out = features;
  if (filters.only4Plus) {
    out = out.filter((f) => f.properties["multifamilial4plus"] === true);
  }
  if (typeof filters.superficieMinM2 === "number") {
    const min = filters.superficieMinM2;
    out = out.filter((f) => {
      const s = f.properties["superficieM2"];
      return typeof s === "number" && s >= min;
    });
  }
  return out;
}

/** Bound + shape a feature page into the uniform result (single code path). */
function boundedResult(opts: {
  city: string;
  collectionId: string;
  features: GeoFeature[];
  limit: number;
  numberMatched: number | null;
  note?: string;
}): RawFeatureCollectionResult {
  const kept = opts.features.slice(0, opts.limit);
  const matched = opts.numberMatched ?? opts.features.length;
  const result: RawFeatureCollectionResult = {
    city: opts.city,
    collectionId: opts.collectionId,
    featureCollection: { type: "FeatureCollection", features: kept },
    numberReturned: kept.length,
    numberMatched: matched,
    truncated: kept.length < matched,
  };
  if (opts.note) result.note = opts.note;
  return result;
}

function parsePvCity(rawRef: string): string | null {
  const m = /raw\/proces-verbaux-([a-z0-9-]+)\//.exec(rawRef);
  return m ? m[1]! : null;
}

// ── Mock implementation (default: zero network, deterministic fixtures) ────

const MOCK_PUBLIC_BASE = "https://immo.example.test";

export class MockRawDataSource implements RawDataSource {
  readonly mode = "mock" as const;

  private cityFeatures(all: MockGeoFeature[], city: string): GeoFeature[] {
    const slug = citySlug(city);
    return all.filter((f) => f.properties["citySlug"] === slug) as GeoFeature[];
  }

  async getZonesGeojson(args: GetZonesGeojsonArgs): Promise<RawFeatureCollectionResult> {
    const features = filterByBbox(this.cityFeatures(MOCK_ZONE_FEATURES, args.city), args.bbox);
    return boundedResult({
      city: citySlug(args.city),
      collectionId: `qc-zonage-${citySlug(args.city)}`,
      features,
      limit: args.limit,
      numberMatched: features.length,
      note: "mode mock: fixtures déterministes (aucun réseau)",
    });
  }

  async getLotsGeojson(args: GetLotsGeojsonArgs): Promise<RawFeatureCollectionResult> {
    const inBbox = filterByBbox(this.cityFeatures(MOCK_LOT_FEATURES, args.city), args.bbox);
    const filtered = filterLots(inBbox, args);
    return boundedResult({
      city: citySlug(args.city),
      collectionId: `qc-lots-${citySlug(args.city)}`,
      features: filtered,
      limit: args.limit,
      numberMatched: filtered.length,
      note: "mode mock: fixtures déterministes (aucun réseau)",
    });
  }

  async getGrillePdf(args: GetGrillePdfArgs): Promise<GrillePdfResult> {
    const wanted = normalizeZoneCode(args.zone);
    const zones = this.cityFeatures(MOCK_ZONE_FEATURES, args.city);
    const hit = zones.find((z) => normalizeZoneCode(zoneCodeOf(z.properties)) === wanted);
    if (!hit) {
      return { found: false, city: citySlug(args.city), zone: wanted };
    }
    const url = grillePdfUrlOf(hit.properties);
    const result: GrillePdfResult = {
      found: true,
      city: citySlug(args.city),
      zone: wanted,
      zoneCode: zoneCodeOf(hit.properties) ?? wanted,
      grillePdfUrl: url,
    };
    if (!url) result.note = "zone trouvée mais la source ne porte pas de grille PDF";
    return result;
  }

  async getPvPdf(args: GetPvPdfArgs): Promise<PvPdfResult> {
    // Mock refs are the mock document ids (list_documents) OR their archive_url.
    const doc = MOCK_DOCUMENTS.find(
      (d) => d.id === args.rawRef || d.archive_url === args.rawRef,
    );
    if (!doc) return { found: false, rawRef: args.rawRef };
    return {
      found: true,
      rawRef: args.rawRef,
      url: `${MOCK_PUBLIC_BASE}/api/documents/raw?rawRef=${encodeURIComponent(doc.id)}`,
      contentType: "application/pdf",
      city: doc.city,
      publishedAt: doc.published_at,
      title: doc.title,
      note: "mode mock: URL illustrative (aucun réseau)",
    };
  }

  async getReglementProvenance(
    args: GetReglementProvenanceArgs,
  ): Promise<ReglementProvenanceResult> {
    const slug = citySlug(args.city);
    // Muni-uniforme : la provenance est identique sur chaque feature → 1re feature.
    const feature = this.cityFeatures(MOCK_ZONE_FEATURES, args.city)[0];
    if (!feature) {
      return notFoundReglementProvenance(
        slug,
        "mode mock: aucune grille de zonage pour cette ville",
      );
    }
    const result = reglementProvenanceFromFeature(slug, feature.properties ?? {});
    result.note = "mode mock: fixtures déterministes (aucun réseau)";
    return result;
  }
}

// ── HTTP implementation (radar API passthrough OGC + proof-viewer route) ───

export interface HttpRawDataSourceOptions {
  /** In-cluster/internal radar API base, e.g. http://radar-api:3000 */
  baseUrl: string;
  /** Public base used for the URLs handed back to the caller (claude.ai). */
  publicBaseUrl: string;
  /** Injectable for tests (default: global fetch). */
  fetchImpl?: typeof fetch;
}

interface UpstreamFeatureCollection {
  type?: unknown;
  features?: unknown;
  numberMatched?: unknown;
  numberReturned?: unknown;
}

export class HttpRawDataSource implements RawDataSource {
  readonly mode = "http" as const;
  private readonly baseUrl: string;
  private readonly publicBaseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: HttpRawDataSourceOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.publicBaseUrl = opts.publicBaseUrl.replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private itemsUrl(collectionId: string, limit: number, bbox?: Bbox): string {
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    if (bbox) params.set("bbox", bbox.join(","));
    params.set("f", "json");
    return `${this.baseUrl}/api/geo/collections/${encodeURIComponent(collectionId)}/items?${params.toString()}`;
  }

  private async fetchItems(
    collectionId: string,
    limit: number,
    bbox?: Bbox,
  ): Promise<{ features: GeoFeature[]; numberMatched: number | null }> {
    const url = this.itemsUrl(collectionId, limit, bbox);
    let res: Response;
    try {
      res = await this.fetchImpl(url);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`radar_api_unreachable: GET ${url} (${detail})`);
    }
    if (res.status === 404) {
      throw new Error(
        `collection_not_found:${collectionId} — ville inconnue ou couche non publiée`,
      );
    }
    if (!res.ok) {
      throw new Error(`radar_api_error:${res.status} GET ${url}`);
    }
    const body = (await res.json()) as UpstreamFeatureCollection;
    if (!Array.isArray(body.features)) {
      throw new Error(`radar_api_bad_payload: pas de FeatureCollection sur ${collectionId}`);
    }
    return {
      features: body.features as GeoFeature[],
      numberMatched: typeof body.numberMatched === "number" ? body.numberMatched : null,
    };
  }

  async getZonesGeojson(args: GetZonesGeojsonArgs): Promise<RawFeatureCollectionResult> {
    const slug = citySlug(args.city);
    const collectionId = `qc-zonage-${slug}`;
    const page = await this.fetchItems(collectionId, args.limit, args.bbox);
    // Defensive re-filter: local-store answers ignore bbox (see filterByBbox).
    const features = filterByBbox(page.features, args.bbox);
    return boundedResult({
      city: slug,
      collectionId,
      features,
      limit: args.limit,
      numberMatched: args.bbox ? null : page.numberMatched,
    });
  }

  async getLotsGeojson(args: GetLotsGeojsonArgs): Promise<RawFeatureCollectionResult> {
    const slug = citySlug(args.city);
    const collectionId = `qc-lots-${slug}`;
    const hasFilters =
      args.only4Plus === true || typeof args.superficieMinM2 === "number";
    // Filters are applied CLIENT-SIDE on the fetched page (the OGC passthrough
    // has no property filters). Over-fetch so `only4Plus` still fills the page,
    // bounded by LOT_FILTER_FETCH_CAP to keep memory/latency sane.
    const fetchLimit = hasFilters
      ? Math.min(args.limit * LOT_FILTER_OVERFETCH, LOT_FILTER_FETCH_CAP)
      : args.limit;
    const page = await this.fetchItems(collectionId, fetchLimit, args.bbox);
    const inBbox = filterByBbox(page.features, args.bbox);
    const filtered = filterLots(inBbox, args);
    const note = hasFilters
      ? `filtres appliqués sur la page récupérée (${inBbox.length} lots examinés)`
      : undefined;
    return boundedResult({
      city: slug,
      collectionId,
      features: filtered,
      limit: args.limit,
      // With client-side bbox/filters the upstream total no longer describes
      // OUR result set — report the filtered count instead (honest bound).
      numberMatched: hasFilters || args.bbox ? filtered.length : page.numberMatched,
      ...(note ? { note } : {}),
    });
  }

  async getGrillePdf(args: GetGrillePdfArgs): Promise<GrillePdfResult> {
    const slug = citySlug(args.city);
    const wanted = normalizeZoneCode(args.zone);
    const page = await this.fetchItems(`qc-zonage-${slug}`, ZONE_LOOKUP_LIMIT);
    const hit = page.features.find(
      (z) => normalizeZoneCode(zoneCodeOf(z.properties ?? {})) === wanted,
    );
    if (!hit) return { found: false, city: slug, zone: wanted };
    const url = grillePdfUrlOf(hit.properties ?? {});
    const result: GrillePdfResult = {
      found: true,
      city: slug,
      zone: wanted,
      zoneCode: zoneCodeOf(hit.properties ?? {}) ?? wanted,
      grillePdfUrl: url,
    };
    if (url) {
      result.note = "URL publique (source municipale) : lisible directement";
    } else {
      result.note = "zone trouvée mais la source ne porte pas de grille PDF";
    }
    return result;
  }

  async getPvPdf(args: GetPvPdfArgs): Promise<PvPdfResult> {
    const encoded = encodeURIComponent(args.rawRef);
    const internalUrl = `${this.baseUrl}/api/documents/raw?rawRef=${encoded}`;
    const publicUrl = `${this.publicBaseUrl}/api/documents/raw?rawRef=${encoded}`;
    let res: Response;
    try {
      res = await this.fetchImpl(internalUrl);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`radar_api_unreachable: GET ${internalUrl} (${detail})`);
    }
    // Existence check only — never buffer the PDF into the tool result.
    await res.body?.cancel().catch(() => undefined);
    if (res.status === 404 || res.status === 400) {
      return { found: false, rawRef: args.rawRef, note: `statut api: ${res.status}` };
    }
    if (!res.ok) {
      throw new Error(`radar_api_error:${res.status} GET /api/documents/raw`);
    }
    const result: PvPdfResult = {
      found: true,
      rawRef: args.rawRef,
      url: publicUrl,
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
    };
    const city = parsePvCity(args.rawRef);
    if (city) result.city = city;
    return result;
  }

  async getReglementProvenance(
    args: GetReglementProvenanceArgs,
  ): Promise<ReglementProvenanceResult> {
    const slug = citySlug(args.city);
    // Provenance muni-uniforme (stampée à l'identique sur chaque feature) → 1 suffit.
    let page: { features: GeoFeature[]; numberMatched: number | null };
    try {
      page = await this.fetchItems(`qc-zonage-norms-${slug}`, 1);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("collection_not_found:")) {
        return notFoundReglementProvenance(
          slug,
          "grille de normes non publiée pour cette ville (qc-zonage-norms absent)",
        );
      }
      throw err;
    }
    const feature = page.features[0];
    if (!feature) {
      return notFoundReglementProvenance(
        slug,
        "collection qc-zonage-norms vide pour cette ville",
      );
    }
    return reglementProvenanceFromFeature(slug, feature.properties ?? {});
  }
}

/**
 * Factory: `RADAR_API_BASE_URL` set → HTTP against the radar API (in-cluster:
 * http://radar-api:3000); unset → mocks. `RADAR_PUBLIC_BASE_URL` overrides the
 * base used in returned document URLs (prod: https://immo.sent-tech.ca).
 */
export function createRawDataSource(env: NodeJS.ProcessEnv): RawDataSource {
  const base = env.RADAR_API_BASE_URL;
  if (base) {
    return new HttpRawDataSource({
      baseUrl: base,
      publicBaseUrl: env.RADAR_PUBLIC_BASE_URL ?? base,
    });
  }
  return new MockRawDataSource();
}
