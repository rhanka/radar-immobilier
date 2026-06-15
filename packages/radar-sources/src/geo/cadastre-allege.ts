/**
 * P0-A — Adapter Cadastre allégé REST (MELCC/MRNF)
 *
 * Source : geo.environnement.gouv.qc.ca / donnees/rest/services/Reference/Cadastre_allege/MapServer/0
 * Couverture : 100 % des 1104 villes du Québec (couche province-entière).
 * Format : ArcGIS REST MapServer `query` → GeoJSON, polygones + champ `NO_LOT`.
 * Auth : aucune. Licence : © Gouv. QC, accès public (attribution requise).
 * Pagination : `resultOffset` + `resultRecordCount` (maxRecordCount=2000 confirmé).
 *
 * Vérification live (2026-06-14) :
 *   - Count total : 4 642 815 lots (`where=1=1&returnCountOnly=true`).
 *   - Champs : `NO_LOT` (string 10), `SHAPE` (geometry), `OBJECTID` (OID).
 *   - Formats supportés : JSON, geoJSON, PBF.
 *   - advancedQueryCapabilities.supportsPagination: true.
 *   - Delson bbox → 5 features, NO_LOT "6 057 912" (vérif 2026-06-14).
 *   - Sainte-Catherine bbox → 7 092 lots confirmés (vérif 2026-06-14).
 *
 * Loi 25 : cette couche ne contient PAS de PII.
 * Elle porte uniquement le numéro de lot cadastral (NO_LOT) et la géométrie.
 *
 * Note architectural : module côté `immo` pour le socle P0, conçu pour
 * migration future vers @sentropic/geo (modulaire, sans dépendance domaine immo).
 */

import { sha256Hex } from "../RawDocument.js";
import type {
  IsoDateString,
  ListOptions,
  RawDocument,
  RawDocumentRef,
  SourceAdapter,
} from "../SourceAdapter.js";
import {
  GEO_FETCH_TIMEOUT_MS,
  GEO_USER_AGENT,
  SourceFetchError,
  type FetchLike,
} from "./geo-fetch-utils.js";

// ─── Constantes publiques ──────────────────────────────────────────────────

/** URL publique de la couche Cadastre allégé (MELCC/MRNF), sans auth. */
export const CADASTRE_ALLEGE_BASE_URL =
  "https://geo.environnement.gouv.qc.ca/donnees/rest/services/Reference/Cadastre_allege/MapServer/0";

/** URL de la ressource query. */
export const CADASTRE_ALLEGE_QUERY_URL = `${CADASTRE_ALLEGE_BASE_URL}/query`;

/** Version de l'adapter. */
export const CADASTRE_ALLEGE_ADAPTER_VERSION = "0.1.0";

/** Nombre max de features par requête (maxRecordCount confirmé = 2000). */
export const CADASTRE_ALLEGE_MAX_RECORD_COUNT = 2000;

// ─── Types publics ─────────────────────────────────────────────────────────

/** Bounding box en WGS84 (EPSG:4326). */
export interface BboxWgs84 {
  readonly minLon: number;
  readonly minLat: number;
  readonly maxLon: number;
  readonly maxLat: number;
}

/** Options de construction de l'adapter. */
export interface CadastreAllegeOptions {
  /** City slug (radar-immobilier). Porté dans le RawDocument. */
  readonly city: string;
  /** Bbox de la municipalité en WGS84. Filtre spatial de la query. */
  readonly bbox: BboxWgs84;
  /** Override de l'URL de base (pour tests / mocks). */
  readonly baseUrl?: string;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
  /** resultRecordCount par page (défaut = 2000). */
  readonly pageSize?: number;
}

/** Un lot cadastral normalisé tel que retourné par le service. */
export interface CadastreLot {
  /** Numéro de lot cadastral (ex. "6 057 912"). Clé de jointure inter-sources. */
  readonly no_lot: string;
  /** OBJECTID ArcGIS (clé interne, non stable entre mises à jour). */
  readonly objectid: number;
  /** Géométrie GeoJSON (Polygon ou MultiPolygon), coordonnées WGS84. */
  readonly geometry: CadastreGeometry;
}

/** Sous-ensemble minimal de GeoJSON geometry pour typage strict. */
export interface CadastreGeometry {
  readonly type: "Polygon" | "MultiPolygon";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly coordinates: any;
}

// ─── Construction de l'URL de query ───────────────────────────────────────

/**
 * Construit l'URL de query paginée pour une bbox + offset donnés.
 *
 * Paramètres clés :
 *   - `geometry` : envelope bbox en WGS84 (JSON encodé)
 *   - `geometryType=esriGeometryEnvelope`
 *   - `inSR=4326` / `outSR=4326` → WGS84 en entrée et sortie
 *   - `outFields=NO_LOT,OBJECTID`
 *   - `returnGeometry=true`
 *   - `f=geojson`
 *   - `resultOffset` + `resultRecordCount` pour pagination
 */
export function buildCadastreQueryUrl(
  baseUrl: string,
  bbox: BboxWgs84,
  offset: number,
  pageSize: number,
): string {
  const geomEnvelope = JSON.stringify({
    xmin: bbox.minLon,
    ymin: bbox.minLat,
    xmax: bbox.maxLon,
    ymax: bbox.maxLat,
  });
  const params = new URLSearchParams({
    geometry: geomEnvelope,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    outSR: "4326",
    outFields: "NO_LOT,OBJECTID",
    returnGeometry: "true",
    f: "geojson",
    resultOffset: String(offset),
    resultRecordCount: String(pageSize),
  });
  return `${baseUrl}/query?${params.toString()}`;
}

/**
 * Construit l'URL pour compter les lots dans une bbox.
 */
export function buildCadastreCountUrl(
  baseUrl: string,
  bbox: BboxWgs84,
): string {
  const geomEnvelope = JSON.stringify({
    xmin: bbox.minLon,
    ymin: bbox.minLat,
    xmax: bbox.maxLon,
    ymax: bbox.maxLat,
  });
  const params = new URLSearchParams({
    geometry: geomEnvelope,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    returnCountOnly: "true",
    f: "json",
  });
  return `${baseUrl}/query?${params.toString()}`;
}

// ─── Normalisation des features ────────────────────────────────────────────

/**
 * Normalise un feature GeoJSON brut en `CadastreLot`.
 * Retourne `null` si le feature est invalide (no_lot manquant, géom absente).
 *
 * Note : NO_LOT contient des espaces (ex. "6 057 912") — on les conserve
 * pour fidélité à la source ; la normalisation (suppression espaces) est
 * responsabilité de la couche immo lors de la jointure.
 */
export function normalizeCadastreFeature(
  feature: unknown,
): CadastreLot | null {
  if (
    !feature ||
    typeof feature !== "object" ||
    (feature as Record<string, unknown>)["type"] !== "Feature"
  ) {
    return null;
  }
  const f = feature as Record<string, unknown>;
  const props =
    (f["properties"] as Record<string, unknown> | null | undefined) ?? {};
  const noLot = props["NO_LOT"];
  const objectid = props["OBJECTID"];
  const geometry = f["geometry"] as Record<string, unknown> | null | undefined;

  if (!noLot || typeof noLot !== "string" || noLot.trim() === "") return null;
  if (objectid == null || typeof objectid !== "number") return null;
  if (
    !geometry ||
    !["Polygon", "MultiPolygon"].includes(geometry["type"] as string)
  ) {
    return null;
  }

  return {
    no_lot: noLot.trim(),
    objectid,
    geometry: {
      type: geometry["type"] as "Polygon" | "MultiPolygon",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      coordinates: geometry["coordinates"] as any,
    },
  };
}

// ─── Adapter ──────────────────────────────────────────────────────────────

/**
 * SourceAdapter pour le Cadastre allégé REST (P0-A).
 *
 * `list()` → yields un seul RawDocumentRef (la FeatureCollection complète).
 * `fetch()` → pagine automatiquement et assemble une FeatureCollection GeoJSON.
 * `fetchAllLots()` → itérateur bas-niveau, lot par lot, paginé.
 */
export class CadastreAllegeAdapter implements SourceAdapter {
  readonly kind = "cadastre-allege" as const;
  readonly city: string;
  readonly version = CADASTRE_ALLEGE_ADAPTER_VERSION;

  private readonly bbox: BboxWgs84;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly now: () => Date;
  private readonly pageSize: number;

  constructor(options: CadastreAllegeOptions) {
    this.city = options.city;
    this.bbox = options.bbox;
    this.baseUrl = options.baseUrl ?? CADASTRE_ALLEGE_BASE_URL;
    this.fetchImpl =
      options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = options.timeoutMs ?? GEO_FETCH_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
    this.pageSize = options.pageSize ?? CADASTRE_ALLEGE_MAX_RECORD_COUNT;
  }

  async *list(_opts: ListOptions): AsyncIterable<RawDocumentRef> {
    const url = buildCadastreQueryUrl(
      this.baseUrl,
      this.bbox,
      0,
      this.pageSize,
    );
    yield {
      sourceKind: this.kind,
      city: this.city,
      url,
      discoveredAt: this.now().toISOString(),
      title: `Cadastre allégé — ${this.city}`,
      contentType: "application/geo+json",
      metadata: {
        bbox: this.bbox,
        adapterVersion: this.version,
      },
    };
  }

  /**
   * Fetch paginé : récupère TOUTES les pages pour la bbox, assemble une
   * FeatureCollection GeoJSON complète et la retourne comme RawDocument.
   */
  async fetch(ref: RawDocumentRef): Promise<RawDocument> {
    const fetchedAt: IsoDateString = this.now().toISOString();
    const lots: CadastreLot[] = [];

    for await (const lot of this.fetchAllLots()) {
      lots.push(lot);
    }

    const fc = {
      type: "FeatureCollection",
      features: lots.map((lot) => ({
        type: "Feature",
        properties: { no_lot: lot.no_lot, objectid: lot.objectid },
        geometry: lot.geometry,
      })),
    };
    const body = new TextEncoder().encode(JSON.stringify(fc));

    return {
      ref,
      sourceKind: this.kind,
      city: this.city,
      url: ref.url,
      fetchedAt,
      contentType: "application/geo+json",
      body,
      sha256: sha256Hex(body),
      provenance: {
        adapterVersion: this.version,
        userAgent: GEO_USER_AGENT,
        fetchedViaObscura: false,
        obtentionMode: "api",
      },
      metadata: {
        bbox: this.bbox,
        lotCount: lots.length,
      },
    };
  }

  hash(raw: RawDocument): string {
    return raw.sha256 ?? sha256Hex(raw.body);
  }

  /**
   * Itérateur paginé de bas niveau : yield un `CadastreLot` par feature.
   * Gère automatiquement la pagination via `resultOffset`.
   * Lance `SourceFetchError` en cas d'erreur réseau/HTTP/parse.
   */
  async *fetchAllLots(): AsyncIterable<CadastreLot> {
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const url = buildCadastreQueryUrl(
        this.baseUrl,
        this.bbox,
        offset,
        this.pageSize,
      );
      const page = await this._fetchPage(url);

      const features: unknown[] = Array.isArray(page["features"])
        ? (page["features"] as unknown[])
        : [];
      let pageCount = 0;

      for (const f of features) {
        const lot = normalizeCadastreFeature(f);
        if (lot !== null) {
          yield lot;
          pageCount++;
        }
      }

      // `exceededTransferLimit: true` = il y a d'autres pages
      const exceeded: boolean = page["exceededTransferLimit"] === true;
      hasMore = exceeded && pageCount > 0;
      offset += pageCount;
    }
  }

  /** Fetch une seule page GeoJSON, retourne le parsed JSON. */
  private async _fetchPage(url: string): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await this.fetchImpl(url, {
          signal: controller.signal,
          headers: {
            "user-agent": GEO_USER_AGENT,
            accept: "application/geo+json, application/json",
          },
        });
      } catch (e) {
        const isAbort = e instanceof Error && e.name === "AbortError";
        throw new SourceFetchError(
          isAbort ? "timeout" : "network",
          e instanceof Error ? e.message : String(e),
          url,
        );
      }

      if (!res.ok) {
        throw new SourceFetchError("http", `HTTP ${res.status}`, url);
      }

      const text = await res.text();
      try {
        return JSON.parse(text) as Record<string, unknown>;
      } catch (e) {
        throw new SourceFetchError(
          "parse",
          `JSON parse error: ${e instanceof Error ? e.message : String(e)}`,
          url,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Factory — cohérent avec le patron des autres adapters du repo. */
export function createCadastreAllegeAdapter(
  options: CadastreAllegeOptions,
): CadastreAllegeAdapter {
  return new CadastreAllegeAdapter(options);
}
