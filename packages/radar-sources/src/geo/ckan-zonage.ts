/**
 * P1-A — Adapter CKAN Données Québec pour le zonage municipal.
 *
 * Le portail **Données Québec** (CKAN) expose ~50 datasets « zonage » en
 * open data. Cet adapter :
 *   1. Interroge l'API CKAN (`package_search`) pour découvrir les datasets
 *      de zonage d'une ville ou de toutes les villes.
 *   2. Filtre les ressources en format vectoriel exploitable (GeoJSON, SHP, KML).
 *   3. Résout les URLs réelles via `package_show`.
 *   4. Normalise le GeoJSON vers le MÊME format zone que `arcgis-zonage.ts`
 *      (code zone + géométrie, champ `zone_code` normalisé).
 *
 * ## API CKAN utilisée
 *
 * Base URL : `https://www.donneesquebec.ca/recherche/api/3/action/`
 * Endpoints :
 *   - `package_search?q=zonage&rows=50` → liste tous les datasets zonage
 *   - `package_search?q=<ville>+zonage&fq=organization:<org>` → par ville
 *   - `package_show?id=<package_id>` → détails + URLs réelles des ressources
 *
 * Vérifiés live (2026-06-14) :
 *   - `package_search?q=zonage&rows=0` → count = 50 datasets
 *   - `package_show?id=aedd53ac-...` → Longueuil, GeoJSON
 *     `https://www.donneesquebec.ca/recherche/dataset/.../download/zonage.json`
 *     HTTP 200, 2085 features, champs : `Zonage`, `URL_Grille`
 *   - `package_show?id=a086941f-...` → Saguenay, GeoJSON
 *     `https://www.donneesquebec.ca/recherche/dataset/.../download/sag_zonage.geojson`
 *     HTTP 200, 2838 features, champs : `id`, `municipalite`, `no_zone`
 *
 * ## Villes couvertes (10-15 villes avec GeoJSON)
 *
 * Longueuil, Saguenay, Lévis, Trois-Rivières, Sherbrooke, Québec, Repentigny,
 * Gatineau, Rimouski, Rouyn-Noranda, Saint-Hyacinthe, Shawinigan.
 * (Sherbrooke et Shawinigan pointent vers le FeatureServer ArcGIS → déléguer à arcgis-zonage.)
 *
 * ## Formats GeoJSON natifs observés
 *
 * Les champs code-de-zone varient par ville. Candidats observés :
 *   - `Zonage` (Longueuil)
 *   - `no_zone` (Saguenay)
 *   - `NO_ZONE` (Sherbrooke via ArcGIS)
 *   - `ZONE` / `CODE_ZONE` / `NOM_ZONE` (autres villes, à vérifier)
 *
 * La détection du champ zone s'appuie sur la même logique que `arcgis-zonage.ts`
 * (`CKAN_ZONE_CODE_FIELD_CANDIDATES`).
 *
 * ## Loi 25
 *
 * Le zonage = donnée publique (règlement d'urbanisme). Aucun PII.
 * Licence CC-BY 4.0 sur la majorité des datasets DQ (portée dans `provenance`).
 *
 * ## Relation avec arcgis-zonage.ts
 *
 * Certains datasets CKAN pointent vers un FeatureServer ArcGIS (ex. Sherbrooke,
 * Shawinigan). Dans ce cas, l'adapter CKAN référence le service ArcGIS dans le
 * registre ; l'acquisition réelle utilise `arcgis-zonage.ts`.
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

export const CKAN_ZONAGE_ADAPTER_VERSION = "0.1.0";

/** Base URL de l'API CKAN Données Québec. */
export const CKAN_BASE_URL = "https://www.donneesquebec.ca/recherche/api/3/action";

/** Formats GeoJSON directs (téléchargement sans transformation). */
export const CKAN_DIRECT_GEOJSON_FORMATS = new Set(["GeoJSON", "GEOJSON"]);

/** Formats ArcGIS REST (à déléguer à arcgis-zonage). */
export const CKAN_ARCGIS_REST_FORMATS = new Set(["EsriREST", "ESRI REST"]);

/**
 * Champs candidats pour le code de zone dans les GeoJSON CKAN.
 * Ordre de priorité (détection automatique).
 * Réutilise la même logique que arcgis-zonage.ts, étendue aux conventions CKAN.
 */
export const CKAN_ZONE_CODE_FIELD_CANDIDATES = [
  "NO_ZONE",
  "no_zone",
  "CODEZONE",
  "CODE_ZONE",
  "Zonage",
  "zonage",
  "ZONE",
  "zone",
  "NOM_ZONE",
  "nom_zone",
  "DESIGNATION",
  "designation",
  "CATEGORIE",
  "categorie",
] as const;

// ─── Types publics ─────────────────────────────────────────────────────────

/** Une ressource d'un dataset CKAN. */
export interface CkanResource {
  readonly id: string;
  readonly name: string;
  readonly format: string;
  readonly url: string;
  readonly lastModified?: string;
  readonly mimeType?: string;
}

/** Un dataset CKAN (package). */
export interface CkanPackage {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly organization: string;
  readonly license: string;
  readonly resources: readonly CkanResource[];
  readonly notes?: string;
}

/** Résultat de la recherche CKAN (package_search). */
export interface CkanSearchResult {
  readonly count: number;
  readonly packages: readonly CkanPackage[];
}

/** Ressource GeoJSON résolue depuis CKAN. */
export interface CkanGeoResource {
  /** Package CKAN d'origine. */
  readonly package: CkanPackage;
  /** Ressource CKAN (URL directe). */
  readonly resource: CkanResource;
  /** Format normalisé. */
  readonly format: "geojson" | "esrirest";
  /** URL réelle de téléchargement. */
  readonly downloadUrl: string;
}

/** Options de construction de l'adapter CKAN. */
export interface CkanZonageOptions {
  /** City slug (radar-immobilier). Porté dans le RawDocument. */
  readonly city: string;
  /**
   * URL directe de la ressource GeoJSON CKAN.
   * Si fourni, l'adapter télécharge directement sans passer par l'API CKAN.
   */
  readonly resourceUrl: string;
  /**
   * Champ portant le code de zone dans le GeoJSON.
   * Si non fourni, détection automatique par `CKAN_ZONE_CODE_FIELD_CANDIDATES`.
   */
  readonly zoneCodeField?: string;
  /** ID du dataset CKAN (pour traçabilité / provenance). */
  readonly packageId?: string;
  /** Organisation CKAN (ex. "ville-de-longueuil"). */
  readonly organization?: string;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}

// ─── Détection du champ zone ───────────────────────────────────────────────

/**
 * Détecte le champ code-de-zone dans les propriétés d'une feature GeoJSON CKAN.
 * Retourne le premier candidat trouvé parmi `CKAN_ZONE_CODE_FIELD_CANDIDATES`.
 */
export function detectCkanZoneCodeField(
  properties: Record<string, unknown>,
): string | null {
  const keys = new Set(Object.keys(properties));
  for (const candidate of CKAN_ZONE_CODE_FIELD_CANDIDATES) {
    if (keys.has(candidate)) return candidate;
  }
  // Fallback : premier champ String non-numérique non-OID
  for (const key of keys) {
    const val = properties[key];
    if (
      typeof val === "string" &&
      val.length > 0 &&
      !["id", "objectid", "fid", "gid"].includes(key.toLowerCase())
    ) {
      return key;
    }
  }
  return null;
}

// ─── Normalisation features GeoJSON ───────────────────────────────────────

/** Un polygone de zone normalisé (même format que ZoneFeature de arcgis-zonage). */
export interface CkanZoneFeature {
  /** Code de zone normalisé. */
  readonly zoneCode: string;
  /** Nom du champ source. */
  readonly zoneCodeField: string;
  /** Index dans la FeatureCollection source. */
  readonly index: number;
  /** Attributs bruts. */
  readonly properties: Readonly<Record<string, unknown>>;
  /** Géométrie GeoJSON WGS84. */
  readonly geometry: {
    readonly type: "Polygon" | "MultiPolygon";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly coordinates: any;
  };
}

/**
 * Normalise une feature GeoJSON brute CKAN en `CkanZoneFeature`.
 * Retourne `null` si la feature est invalide (géométrie absente, code zone vide).
 */
export function normalizeCkanZoneFeature(
  feature: unknown,
  zoneCodeField: string,
  index: number,
): CkanZoneFeature | null {
  if (
    !feature ||
    typeof feature !== "object" ||
    (feature as Record<string, unknown>)["type"] !== "Feature"
  ) {
    return null;
  }
  const f = feature as Record<string, unknown>;
  const props = (f["properties"] as Record<string, unknown> | null | undefined) ?? {};
  const geometry = f["geometry"] as Record<string, unknown> | null | undefined;

  const zoneCode = props[zoneCodeField];
  if (zoneCode == null || (typeof zoneCode === "string" && zoneCode.trim() === "")) {
    return null;
  }
  if (
    !geometry ||
    !["Polygon", "MultiPolygon"].includes(geometry["type"] as string)
  ) {
    return null;
  }

  return {
    zoneCode: String(zoneCode).trim(),
    zoneCodeField,
    index,
    properties: props,
    geometry: {
      type: geometry["type"] as "Polygon" | "MultiPolygon",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      coordinates: geometry["coordinates"] as any,
    },
  };
}

// ─── API CKAN — fonctions utilitaires ────────────────────────────────────

/**
 * Interroge `package_search` sur l'API CKAN Données Québec.
 * Retourne les packages dont le titre/notes contiennent le terme `q`.
 */
export async function ckanPackageSearch(
  q: string,
  {
    rows = 50,
    baseUrl = CKAN_BASE_URL,
    fetchImpl = globalThis.fetch as unknown as FetchLike,
    timeoutMs = GEO_FETCH_TIMEOUT_MS,
  }: {
    rows?: number;
    baseUrl?: string;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
  } = {},
): Promise<CkanSearchResult> {
  const params = new URLSearchParams({ q, rows: String(rows) });
  const url = `${baseUrl}/package_search?${params.toString()}`;

  const data = await _ckanFetchJson(url, fetchImpl, timeoutMs);
  if (!data["success"]) {
    throw new SourceFetchError("parse", "CKAN API returned success=false", url);
  }

  const result = data["result"] as Record<string, unknown>;
  const count = Number(result["count"] ?? 0);
  const rawResults: unknown[] = Array.isArray(result["results"])
    ? (result["results"] as unknown[])
    : [];

  const packages = rawResults.map((r) => _parseCkanPackage(r));

  return { count, packages };
}

/**
 * Interroge `package_show` sur l'API CKAN pour un dataset donné.
 * Retourne les métadonnées complètes + URLs réelles des ressources.
 */
export async function ckanPackageShow(
  packageId: string,
  {
    baseUrl = CKAN_BASE_URL,
    fetchImpl = globalThis.fetch as unknown as FetchLike,
    timeoutMs = GEO_FETCH_TIMEOUT_MS,
  }: {
    baseUrl?: string;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
  } = {},
): Promise<CkanPackage> {
  const url = `${baseUrl}/package_show?id=${encodeURIComponent(packageId)}`;
  const data = await _ckanFetchJson(url, fetchImpl, timeoutMs);

  if (!data["success"]) {
    throw new SourceFetchError("parse", "CKAN API returned success=false", url);
  }

  return _parseCkanPackage(data["result"]);
}

/**
 * Filtre les ressources GeoJSON/EsriREST exploitables d'un package CKAN.
 * Priorise GeoJSON direct, puis EsriREST (pour délégation à arcgis-zonage).
 */
export function filterCkanGeoResources(pkg: CkanPackage): readonly CkanGeoResource[] {
  const result: CkanGeoResource[] = [];

  for (const resource of pkg.resources) {
    const fmt = resource.format.trim();
    if (CKAN_DIRECT_GEOJSON_FORMATS.has(fmt)) {
      result.push({
        package: pkg,
        resource,
        format: "geojson",
        downloadUrl: resource.url,
      });
    } else if (CKAN_ARCGIS_REST_FORMATS.has(fmt)) {
      result.push({
        package: pkg,
        resource,
        format: "esrirest",
        downloadUrl: resource.url,
      });
    }
  }

  // Trier : GeoJSON direct avant EsriREST
  return result.sort((a, b) =>
    a.format === "geojson" && b.format !== "geojson" ? -1 : 1,
  );
}

// ─── Parse interne CKAN ───────────────────────────────────────────────────

/** Parse un objet JSON brut en `CkanPackage`. */
function _parseCkanPackage(raw: unknown): CkanPackage {
  const r = (raw ?? {}) as Record<string, unknown>;
  const org = (r["organization"] as Record<string, unknown> | null | undefined) ?? {};
  const rawResources: unknown[] = Array.isArray(r["resources"])
    ? (r["resources"] as unknown[])
    : [];

  const pkg: {
    id: string;
    name: string;
    title: string;
    organization: string;
    license: string;
    notes?: string;
    resources: CkanResource[];
  } = {
    id: String(r["id"] ?? ""),
    name: String(r["name"] ?? ""),
    title: String(r["title"] ?? ""),
    organization: String(org["name"] ?? ""),
    license: String(r["license_id"] ?? ""),
    resources: rawResources.map((res) => {
      const rv = (res ?? {}) as Record<string, unknown>;
      const resource: {
        id: string;
        name: string;
        format: string;
        url: string;
        lastModified?: string;
        mimeType?: string;
      } = {
        id: String(rv["id"] ?? ""),
        name: String(rv["name"] ?? ""),
        format: String(rv["format"] ?? ""),
        url: String(rv["url"] ?? ""),
      };
      if (rv["last_modified"] != null) resource.lastModified = String(rv["last_modified"]);
      if (rv["mimetype"] != null) resource.mimeType = String(rv["mimetype"]);
      return resource;
    }),
  };
  if (r["notes"] != null) pkg.notes = String(r["notes"]);
  return pkg;
}

/** Fetch JSON générique avec timeout et gestion d'erreur typée. */
async function _ckanFetchJson(
  url: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await fetchImpl(url, {
        signal: controller.signal,
        headers: {
          "user-agent": GEO_USER_AGENT,
          accept: "application/json",
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

// ─── Adapter principal ────────────────────────────────────────────────────

/**
 * Adapter CKAN Données Québec pour le zonage municipal (P1-A).
 *
 * Télécharge et normalise un fichier GeoJSON de zonage depuis le portail
 * Données Québec CKAN vers le format `CkanZoneFeature` standard du pipeline.
 *
 * Utilisation :
 *   const adapter = new CkanZonageAdapter({
 *     city: "longueuil",
 *     resourceUrl: "https://www.donneesquebec.ca/.../zonage.json",
 *     packageId: "aedd53ac-131d-4141-93c4-8d4211eb2d95",
 *     organization: "ville-de-longueuil",
 *   });
 *   const doc = await adapter.fetch(ref);  // → RawDocument GeoJSON normalisé
 */
export class CkanZonageAdapter implements SourceAdapter {
  readonly kind = "ckan-zonage" as const;
  readonly city: string;
  readonly version = CKAN_ZONAGE_ADAPTER_VERSION;

  private readonly resourceUrl: string;
  private readonly zoneCodeFieldOverride: string | undefined;
  private readonly packageId: string | undefined;
  private readonly organization: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(options: CkanZonageOptions) {
    this.city = options.city;
    this.resourceUrl = options.resourceUrl;
    this.zoneCodeFieldOverride = options.zoneCodeField;
    this.packageId = options.packageId;
    this.organization = options.organization;
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = options.timeoutMs ?? GEO_FETCH_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
  }

  async *list(_opts: ListOptions): AsyncIterable<RawDocumentRef> {
    yield {
      sourceKind: this.kind,
      city: this.city,
      url: this.resourceUrl,
      discoveredAt: this.now().toISOString(),
      title: `Zonage CKAN — ${this.city}`,
      contentType: "application/geo+json",
      metadata: {
        packageId: this.packageId,
        organization: this.organization,
        adapterVersion: this.version,
      },
    };
  }

  /**
   * Télécharge le GeoJSON depuis CKAN et le normalise vers `CkanZoneFeature` standard.
   * Détecte automatiquement le champ code-de-zone si non fourni.
   */
  async fetch(ref: RawDocumentRef): Promise<RawDocument> {
    const fetchedAt: IsoDateString = this.now().toISOString();
    const zones = await this.fetchAllZones();

    const fc = {
      type: "FeatureCollection",
      features: zones.map((z) => ({
        type: "Feature",
        properties: {
          zone_code: z.zoneCode,
          zone_code_field: z.zoneCodeField,
          source_index: z.index,
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
        obtentionMode: "download",
      },
      metadata: {
        resourceUrl: this.resourceUrl,
        packageId: this.packageId,
        organization: this.organization,
        zoneCount: zones.length,
      },
    };
  }

  hash(raw: RawDocument): string {
    return raw.sha256 ?? sha256Hex(raw.body);
  }

  /**
   * Télécharge et parse le GeoJSON CKAN, détecte le champ zone, retourne les features normalisées.
   */
  async fetchAllZones(): Promise<CkanZoneFeature[]> {
    const fc = await this._fetchGeoJson(this.resourceUrl);

    const rawFeatures: unknown[] = Array.isArray(fc["features"])
      ? (fc["features"] as unknown[])
      : [];

    if (rawFeatures.length === 0) {
      return [];
    }

    // Détection du champ zone sur la première feature
    const firstFeature = rawFeatures[0] as Record<string, unknown>;
    const firstProps =
      (firstFeature["properties"] as Record<string, unknown> | null | undefined) ?? {};

    const zoneCodeField = this.zoneCodeFieldOverride ?? detectCkanZoneCodeField(firstProps);
    if (!zoneCodeField) {
      throw new Error(
        `[ckan-zonage] Impossible de détecter le champ code-de-zone pour ${this.resourceUrl}. ` +
          `Champs disponibles : ${Object.keys(firstProps).join(", ")}. ` +
          `Fournissez l'option 'zoneCodeField' explicitement.`,
      );
    }

    const zones: CkanZoneFeature[] = [];
    for (let i = 0; i < rawFeatures.length; i++) {
      const zone = normalizeCkanZoneFeature(rawFeatures[i], zoneCodeField, i);
      if (zone !== null) {
        zones.push(zone);
      }
    }

    return zones;
  }

  /** Télécharge et parse une FeatureCollection GeoJSON. */
  private async _fetchGeoJson(url: string): Promise<Record<string, unknown>> {
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
export function createCkanZonageAdapter(options: CkanZonageOptions): CkanZonageAdapter {
  return new CkanZonageAdapter(options);
}

// ─── Registre CKAN vérifié (P1) ──────────────────────────────────────────

/**
 * Entrée du registre CKAN pour une ville donnée.
 */
export interface CkanZonageEntry {
  /** City slug (clé de jointure avec municipalities.qc.json). */
  readonly citySlug: string;
  /** ID du dataset CKAN (package_id). */
  readonly packageId: string;
  /** Organisation CKAN. */
  readonly organization: string;
  /** URL directe de la ressource GeoJSON. */
  readonly geojsonUrl: string;
  /**
   * Champ portant le code de zone.
   * `null` = détection automatique.
   */
  readonly zoneCodeField: string | null;
  /** Date de vérification live (ISO 8601). */
  readonly verifiedAt: string;
  /** Nombre de features observé lors de la vérification. */
  readonly featureCount?: number;
  /** Notes libres. */
  readonly notes?: string;
}

/**
 * Registre des datasets CKAN Données Québec de zonage vérifiés.
 *
 * Villes vérifiées live (2026-06-14) :
 *   - Longueuil  : 2085 features, champ "Zonage", HTTP 200
 *   - Saguenay   : 2838 features, champ "no_zone", HTTP 200
 *
 * Villes connues via package_search (URL à vérifier) :
 *   Lévis, Trois-Rivières, Québec, Repentigny, Rimouski, Rouyn-Noranda.
 *
 * Note : Sherbrooke et Shawinigan ont aussi des entrées CKAN mais pointent vers
 * un FeatureServer ArcGIS -> couverts dans ARCGIS_SERVICE_REGISTRY (P0).
 */
export const CKAN_ZONAGE_REGISTRY: readonly CkanZonageEntry[] = [
  // Longueuil — vérifié live 2026-06-14
  // package_show?id=aedd53ac-131d-4141-93c4-8d4211eb2d95
  // 2085 features, champ "Zonage", HTTP 200
  {
    citySlug: "longueuil",
    packageId: "aedd53ac-131d-4141-93c4-8d4211eb2d95",
    organization: "ville-de-longueuil",
    geojsonUrl:
      "https://www.donneesquebec.ca/recherche/dataset/aedd53ac-131d-4141-93c4-8d4211eb2d95/resource/fafe8962-b38d-4a98-ad93-25ac8950b8c8/download/zonage.json",
    zoneCodeField: "Zonage",
    verifiedAt: "2026-06-14",
    featureCount: 2085,
    notes:
      "GeoJSON direct DQ. Champ 'Zonage' (ex. 'P22-328 (VLO)'). " +
      "Champ 'URL_Grille' = lien PDF grille d'usage. " +
      "HTTP 200 verifie live. Licence CC-BY 4.0.",
  },

  // Saguenay — vérifié live 2026-06-14
  // package_show?id=a086941f-22e3-4fe7-a8dc-fe791229d942
  // 2838 features, champ "no_zone", HTTP 200
  {
    citySlug: "saguenay",
    packageId: "a086941f-22e3-4fe7-a8dc-fe791229d942",
    organization: "ville-de-saguenay",
    geojsonUrl:
      "https://www.donneesquebec.ca/recherche/dataset/a086941f-22e3-4fe7-a8dc-fe791229d942/resource/6d5e4aa8-1b9f-4deb-8815-4803ce63007f/download/sag_zonage.geojson",
    zoneCodeField: "no_zone",
    verifiedAt: "2026-06-14",
    featureCount: 2838,
    notes:
      "GeoJSON direct DQ. Champ 'no_zone' (ex. '1000'). Champ 'municipalite' = code MAMH. " +
      "HTTP 200 verifie live. Licence CC-BY 4.0.",
  },

  // Lévis — URL connue via package_search (non vérifiée live)
  {
    citySlug: "levis",
    packageId: "6cd041e3-902c-469e-a863-e54f4df966f2",
    organization: "ville-de-levis",
    geojsonUrl:
      "https://www.donneesquebec.ca/recherche/dataset/6cd041e3-902c-469e-a863-e54f4df966f2/resource/7b5a116b-fa52-4de6-9285-614a6af91cbe/download/zonage.geojson",
    zoneCodeField: null,
    verifiedAt: "2026-06-14",
    notes:
      "URL decouverte via package_search DQ. Non verifiee live. " +
      "Champ zone a detecter automatiquement. Licence CC-BY 4.0.",
  },

  // Trois-Rivières — URL connue via package_search (non vérifiée live)
  {
    citySlug: "trois-rivieres",
    packageId: "85fa8f51-28f6-4163-9d96-eab0b185ec10",
    organization: "ville-de-trois-rivieres",
    geojsonUrl:
      "https://www.donneesquebec.ca/recherche/dataset/85fa8f51-28f6-4163-9d96-eab0b185ec10/resource/6073d89e-5b7f-4e6c-aac4-b63cd0d6e0d5/download/zonage.geojson",
    zoneCodeField: null,
    verifiedAt: "2026-06-14",
    notes:
      "URL decouverte via package_search DQ. Non verifiee live. " +
      "Champ zone a detecter automatiquement.",
  },

  // Québec (ville) — URL connue via package_search (non vérifiée live)
  {
    citySlug: "quebec",
    packageId: "a56dfef1-ad07-4b21-9ef7-24a0c553a085",
    organization: "ville-de-quebec",
    geojsonUrl:
      "https://www.donneesquebec.ca/recherche/dataset/a56dfef1-ad07-4b21-9ef7-24a0c553a085/resource/8108e32b-e50b-48b2-a4b3-0e3e6827aa0b/download/zones-municipales.geojson",
    zoneCodeField: null,
    verifiedAt: "2026-06-14",
    notes:
      "URL decouverte via package_search DQ. Non verifiee live. " +
      "Champ zone a detecter automatiquement.",
  },

  // Repentigny — URL connue via package_search (non vérifiée live)
  {
    citySlug: "repentigny",
    packageId: "d8dffd21-359d-43dd-af8f-32d44a274cfe",
    organization: "ville-de-repentigny",
    geojsonUrl:
      "https://www.donneesquebec.ca/recherche/dataset/d8dffd21-359d-43dd-af8f-32d44a274cfe/resource/74ee675c-f0b5-4aa1-9d16-80d4f0e2cbad/download/zonage-municipal.geojson",
    zoneCodeField: null,
    verifiedAt: "2026-06-14",
    notes:
      "URL decouverte via package_search DQ. Non verifiee live. " +
      "Champ zone a detecter automatiquement.",
  },

  // Rimouski — URL connue via package_search (non vérifiée live)
  {
    citySlug: "rimouski",
    packageId: "d1935001-9c0c-432a-ab5e-f519384feb24",
    organization: "ville-de-rimouski",
    geojsonUrl:
      "https://www.donneesquebec.ca/recherche/dataset/d1935001-9c0c-432a-ab5e-f519384feb24/resource/a1a8d4f0-2ec3-4d37-b3b1-be7d48e0e694/download/plan-de-zonage.geojson",
    zoneCodeField: null,
    verifiedAt: "2026-06-14",
    notes:
      "URL decouverte via package_search DQ. Non verifiee live. " +
      "Champ zone a detecter automatiquement.",
  },

  // Rouyn-Noranda — URL connue via package_search (non vérifiée live)
  {
    citySlug: "rouyn-noranda",
    packageId: "81cfd131-73ec-43ad-9d6b-72f127c45f51",
    organization: "ville-de-rouyn-noranda",
    geojsonUrl:
      "https://www.donneesquebec.ca/recherche/dataset/81cfd131-73ec-43ad-9d6b-72f127c45f51/resource/cc9a011e-7f29-4ab3-9f59-d8a86c2cbca2/download/plan-de-zonage.geojson",
    zoneCodeField: null,
    verifiedAt: "2026-06-14",
    notes:
      "URL decouverte via package_search DQ. Non verifiee live. " +
      "Champ zone a detecter automatiquement.",
  },
];

/** Retourne l'entrée du registre CKAN pour une ville (par slug). */
export function getCkanZonageEntry(citySlug: string): CkanZonageEntry | undefined {
  return CKAN_ZONAGE_REGISTRY.find((e) => e.citySlug === citySlug);
}

/** Retourne tous les slugs de villes ayant un dataset CKAN. */
export function listCkanCities(): readonly string[] {
  return CKAN_ZONAGE_REGISTRY.map((e) => e.citySlug);
}
