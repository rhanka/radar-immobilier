/**
 * P0-B — Crawler ArcGIS REST générique pour les zones municipales.
 *
 * Ce module implémente un crawler GÉNÉRIQUE réutilisable sur toutes les villes
 * QC dont le plan de zonage est exposé via ArcGIS REST FeatureServer/MapServer.
 *
 * ## Principe
 *
 * Donné une URL de service ArcGIS REST (`serviceUrl` = FeatureServer/N ou
 * MapServer/N), ce crawler :
 *   1. Lit les métadonnées de la couche (`?f=json`) pour connaître les champs.
 *   2. Pagine la couche (`query?where=1=1&f=geojson&resultOffset=...`).
 *   3. Normalise chaque feature en `ZoneFeature` (code zone + géométrie WGS84).
 *   4. Assemble une FeatureCollection GeoJSON normalisée.
 *
 * ## Villes vérifiées (2026-06-14)
 *
 * | Ville       | URL service ArcGIS                                                              | Champ zone        | Count  | Source     |
 * |-------------|---------------------------------------------------------------------------------|-------------------|--------|------------|
 * | Longueuil   | services2.arcgis.com/h4XWvDXfYYyD6jNu/.../DO_Zonage/FeatureServer/0            | `Zonage`          | ~2000+ | AGOL Hub   |
 * | Shawinigan  | cartes.shawinigan.ca/server/rest/services/Zonage_municipal/FeatureServer/0      | `zone_`           | ~2000+ | DQ CKAN    |
 * | Sherbrooke  | services3.arcgis.com/qsNXG7LzoUbR4c1C/.../Zonage/FeatureServer/0               | `NO_ZONE`         | ~2000+ | DQ CKAN    |
 *
 * Données vérifiées live (requête GeoJSON 3 features) :
 *   - Longueuil  : zone "H34-327 (VLO)", geom Polygon, url_grille PDF
 *   - Shawinigan : zone_ "H-9509", usage_ "H"
 *   - Sherbrooke : NO_ZONE "A1336", GRILLEUSAGE url vers grille Sherbrooke
 *
 * ## Détection automatique du champ zone
 *
 * Le champ code-de-zone varie par ville. La détection se fait par candidats
 * prioritaires : `NO_ZONE`, `CODEZONE`, `CODE_ZONE`, `Zonage`, `zone_`,
 * `ZONE`, `DESIGNATION`. Fallback : premier champ String non-OID/SHAPE.
 *
 * ## Auth
 *
 * Aucune auth requise pour les services publics QC testés. Si un service
 * retourne 403/401, il faut l'exclure de l'inventaire (non supporté par ce crawler).
 *
 * ## Loi 25
 *
 * Le zonage = donnée publique (règlement d'urbanisme). Aucun PII.
 *
 * ## Backlog T3/T4/T5 différé-planifié
 *
 * T3 JMap (K2 Geospatial) : API JSON propriétaire, rétro-ingénierie réseau,
 *    effort 3-8 j/déploiement. Planifié S4.
 * T4 GOnet/Azimut (PG Solutions) : souvent derrière login, difficilement
 *    scrapable sans auth. Planifié S4 (cas par cas, si export public disponible).
 * T5 PDF scannés (~600-800 villes) : requiert OCR + géoréférencement + vectorisation.
 *    Planifié (le principal confirme qu'on finira par les faire), mais hors
 *    portée automatisée — fallback éditeur de zones semi-manuel (Steve).
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

// ─── Constantes ────────────────────────────────────────────────────────────

export const ARCGIS_ZONAGE_ADAPTER_VERSION = "0.1.0";

/** Nombre max de features par page (respecte le maxRecordCount du service). */
export const ARCGIS_ZONAGE_DEFAULT_PAGE_SIZE = 2000;

/**
 * Champs candidats pour le code de zone, par ordre de priorité.
 * Le premier champ présent dans la couche est retenu.
 */
export const ZONE_CODE_FIELD_CANDIDATES = [
  "NO_ZONE",
  "CODEZONE",
  "CODE_ZONE",
  "Zonage",
  "zone_",
  "ZONE",
  "DESIGNATION",
  "NOM_ZONE",
  "CATEGORIE",
] as const;

// ─── Types publics ─────────────────────────────────────────────────────────

/** Métadonnées d'un champ ArcGIS. */
export interface ArcgisField {
  readonly name: string;
  readonly type: string;
  readonly alias?: string;
}

/** Métadonnées d'une couche ArcGIS REST. */
export interface ArcgisLayerInfo {
  readonly name: string;
  readonly geometryType: string;
  readonly maxRecordCount: number;
  readonly fields: readonly ArcgisField[];
  readonly supportedQueryFormats: string;
}

/** Un polygone de zone normalisé. */
export interface ZoneFeature {
  /** Code de zone (ex. "H34-327 (VLO)", "H-9509", "A1336"). */
  readonly zoneCode: string;
  /** Nom du champ source d'où provient le code (pour traçabilité). */
  readonly zoneCodeField: string;
  /** OBJECTID ArcGIS (clé interne du service). */
  readonly objectid: number;
  /** Tous les attributs bruts de la feature (pour conservation fidèle). */
  readonly properties: Readonly<Record<string, unknown>>;
  /** Géométrie GeoJSON WGS84. */
  readonly geometry: ArcgisZoneGeometry;
}

/** Géométrie GeoJSON (Polygon ou MultiPolygon). */
export interface ArcgisZoneGeometry {
  readonly type: "Polygon" | "MultiPolygon";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly coordinates: any;
}

/** Options de construction du crawler générique. */
export interface ArcgisZonageOptions {
  /** City slug (radar-immobilier). Porté dans le RawDocument. */
  readonly city: string;
  /**
   * URL de la couche ArcGIS REST (FeatureServer/N ou MapServer/N).
   * Exemples :
   *   - "https://services2.arcgis.com/h4XWvDXfYYyD6jNu/arcgis/rest/services/DO_Zonage/FeatureServer/0"
   *   - "https://cartes.shawinigan.ca/server/rest/services/Zonage_municipal/FeatureServer/0"
   */
  readonly serviceUrl: string;
  /**
   * Nom du champ code de zone.
   * Si non fourni, détection automatique par `ZONE_CODE_FIELD_CANDIDATES`.
   */
  readonly zoneCodeField?: string;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
  /** Taille de page (défaut = 2000 ou maxRecordCount du service si inférieur). */
  readonly pageSize?: number;
}

// ─── Détection du champ zone ───────────────────────────────────────────────

/**
 * Détecte le champ code-de-zone dans la liste des champs ArcGIS.
 * Retourne le nom du champ, ou `null` si aucun candidat trouvé.
 */
export function detectZoneCodeField(fields: readonly ArcgisField[]): string | null {
  const fieldNames = new Set(fields.map((f) => f.name));

  // Priorité par liste ordonnée
  for (const candidate of ZONE_CODE_FIELD_CANDIDATES) {
    if (fieldNames.has(candidate)) return candidate;
  }

  // Fallback : premier champ String non-OID/SHAPE/geometry
  const stringField = fields.find(
    (f) =>
      f.type === "esriFieldTypeString" &&
      !["OBJECTID", "SHAPE", "Shape", "GlobalID", "GlobalId"].includes(
        f.name,
      ) &&
      !f.type.toLowerCase().includes("oid") &&
      !f.type.toLowerCase().includes("geometry"),
  );
  return stringField?.name ?? null;
}

// ─── Normalisation ─────────────────────────────────────────────────────────

/**
 * Normalise un feature GeoJSON brut en `ZoneFeature`.
 * Retourne `null` si le feature est invalide.
 */
export function normalizeZoneFeature(
  feature: unknown,
  zoneCodeField: string,
): ZoneFeature | null {
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
  const geometry = f["geometry"] as Record<string, unknown> | null | undefined;

  const zoneCode = props[zoneCodeField];
  const objectid = props["OBJECTID"] ?? props["objectid"] ?? props["FID"];

  if (
    zoneCode == null ||
    (typeof zoneCode === "string" && zoneCode.trim() === "")
  ) {
    return null;
  }
  if (objectid == null || typeof objectid !== "number") return null;
  if (
    !geometry ||
    !["Polygon", "MultiPolygon"].includes(geometry["type"] as string)
  ) {
    return null;
  }

  return {
    zoneCode: String(zoneCode).trim(),
    zoneCodeField,
    objectid,
    properties: props,
    geometry: {
      type: geometry["type"] as "Polygon" | "MultiPolygon",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      coordinates: geometry["coordinates"] as any,
    },
  };
}

// ─── Crawler ──────────────────────────────────────────────────────────────

/**
 * Crawler ArcGIS REST générique pour les couches de zonage municipal (P0-B).
 *
 * Utilisation :
 *   const crawler = new ArcgisZonageAdapter({
 *     city: "longueuil",
 *     serviceUrl: "https://services2.arcgis.com/.../DO_Zonage/FeatureServer/0",
 *   });
 *   for await (const zone of crawler.fetchAllZones()) { ... }
 */
export class ArcgisZonageAdapter implements SourceAdapter {
  readonly kind = "arcgis-zonage" as const;
  readonly city: string;
  readonly version = ARCGIS_ZONAGE_ADAPTER_VERSION;

  private readonly serviceUrl: string;
  private readonly zoneCodeFieldOverride: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly now: () => Date;
  private readonly pageSizeOverride: number | undefined;

  constructor(options: ArcgisZonageOptions) {
    this.city = options.city;
    this.serviceUrl = options.serviceUrl.replace(/\/$/, ""); // strip trailing slash
    this.zoneCodeFieldOverride = options.zoneCodeField;
    this.fetchImpl =
      options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = options.timeoutMs ?? GEO_FETCH_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
    this.pageSizeOverride = options.pageSize;
  }

  async *list(_opts: ListOptions): AsyncIterable<RawDocumentRef> {
    const url = `${this.serviceUrl}/query?where=1%3D1&outFields=*&returnGeometry=true&f=geojson&resultRecordCount=1`;
    yield {
      sourceKind: this.kind,
      city: this.city,
      url,
      discoveredAt: this.now().toISOString(),
      title: `Zonage ArcGIS REST — ${this.city}`,
      contentType: "application/geo+json",
      metadata: {
        serviceUrl: this.serviceUrl,
        adapterVersion: this.version,
      },
    };
  }

  /**
   * Fetch paginé : récupère TOUTES les zones, assemble une FeatureCollection
   * GeoJSON normalisée retournée comme RawDocument.
   */
  async fetch(ref: RawDocumentRef): Promise<RawDocument> {
    const fetchedAt: IsoDateString = this.now().toISOString();
    const zones: ZoneFeature[] = [];

    for await (const zone of this.fetchAllZones()) {
      zones.push(zone);
    }

    const fc = {
      type: "FeatureCollection",
      features: zones.map((z) => ({
        type: "Feature",
        properties: {
          zone_code: z.zoneCode,
          zone_code_field: z.zoneCodeField,
          objectid: z.objectid,
          ...z.properties,
        },
        geometry: z.geometry,
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
        serviceUrl: this.serviceUrl,
        zoneCount: zones.length,
      },
    };
  }

  hash(raw: RawDocument): string {
    return raw.sha256 ?? sha256Hex(raw.body);
  }

  /**
   * Récupère les métadonnées de la couche ArcGIS (`?f=json`).
   * Utilisé pour détecter le champ zone et le maxRecordCount.
   */
  async fetchLayerInfo(): Promise<ArcgisLayerInfo> {
    const url = `${this.serviceUrl}?f=json`;
    const data = await this._fetchJson(url);

    const name = String(data["name"] ?? "");
    const geometryType = String(data["geometryType"] ?? "");
    const maxRecordCount = Number(data["maxRecordCount"] ?? ARCGIS_ZONAGE_DEFAULT_PAGE_SIZE);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawFields: any[] = Array.isArray(data["fields"])
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (data["fields"] as any[])
      : [];
    const fields: ArcgisField[] = rawFields.map((f) => {
      const field: ArcgisField = {
        name: String(f["name"] ?? ""),
        type: String(f["type"] ?? ""),
      };
      if (f["alias"] != null) {
        return { ...field, alias: String(f["alias"]) };
      }
      return field;
    });
    const supportedQueryFormats = String(
      data["supportedQueryFormats"] ?? "JSON",
    );

    return { name, geometryType, maxRecordCount, fields, supportedQueryFormats };
  }

  /**
   * Itérateur paginé de bas niveau : yield une `ZoneFeature` par polygone.
   * Gère automatiquement la pagination via `resultOffset`.
   */
  async *fetchAllZones(): AsyncIterable<ZoneFeature> {
    // 1. Métadonnées pour champ zone + pageSize
    const layerInfo = await this.fetchLayerInfo();

    const zoneCodeField =
      this.zoneCodeFieldOverride ?? detectZoneCodeField(layerInfo.fields);
    if (!zoneCodeField) {
      throw new Error(
        `[arcgis-zonage] Impossible de détecter le champ code-de-zone pour ${this.serviceUrl}. ` +
          `Champs disponibles : ${layerInfo.fields.map((f) => f.name).join(", ")}. ` +
          `Fournissez l'option 'zoneCodeField' explicitement.`,
      );
    }

    const pageSize = Math.min(
      this.pageSizeOverride ?? ARCGIS_ZONAGE_DEFAULT_PAGE_SIZE,
      layerInfo.maxRecordCount > 0
        ? layerInfo.maxRecordCount
        : ARCGIS_ZONAGE_DEFAULT_PAGE_SIZE,
    );

    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const url = this._buildQueryUrl(offset, pageSize, zoneCodeField);
      const page = await this._fetchJson(url);

      const features: unknown[] = Array.isArray(page["features"])
        ? (page["features"] as unknown[])
        : [];
      let pageCount = 0;

      for (const f of features) {
        const zone = normalizeZoneFeature(f, zoneCodeField);
        if (zone !== null) {
          yield zone;
          pageCount++;
        }
      }

      const exceeded: boolean = page["exceededTransferLimit"] === true;
      hasMore = exceeded && pageCount > 0;
      offset += pageCount;
    }
  }

  /** Construit l'URL de query pour une page donnée. */
  private _buildQueryUrl(
    offset: number,
    pageSize: number,
    zoneCodeField: string,
  ): string {
    const outFields = ["OBJECTID", "objectid", "FID", zoneCodeField]
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .join(",");
    const params = new URLSearchParams({
      where: "1=1",
      outFields,
      returnGeometry: "true",
      outSR: "4326",
      f: "geojson",
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
    });
    return `${this.serviceUrl}/query?${params.toString()}`;
  }

  /** Fetch JSON générique (métadonnées ou page de features). */
  private async _fetchJson(url: string): Promise<Record<string, unknown>> {
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
export function createArcgisZonageAdapter(
  options: ArcgisZonageOptions,
): ArcgisZonageAdapter {
  return new ArcgisZonageAdapter(options);
}
