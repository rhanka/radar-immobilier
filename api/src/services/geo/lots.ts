/**
 * Service lots cadastraux — WP B slice-1 (zone → lot).
 *
 * Lit l'inventaire GeoSourceInventory pour une ville ; si
 * `lots.availability === "donnees-quebec"` interroge le MapServer ArcGIS MRNF
 * (Cadastre_allege) et retourne un FeatureCollection GeoJSON normalisé.
 *
 * ## Corrections WP-B-lotsfix (2026-06-10)
 *
 * - URL de base corrigée : /donnees/rest/services/Reference/Cadastre_allege/...
 *   (l'ancien chemin /arcgis/rest/services/Mern/... retournait HTTP 404).
 * - Requête bornée par bbox : inSR=4326, outSR=4326, geometry+geometryType+spatialRel.
 *   Sans bbox la query `where=1=1` est rejetée par le MapServer MRNF (HTTP 404).
 * - Si opts.bbox fourni (EPSG:4326) → utilisé directement.
 *   Sinon → bbox par défaut par ville (table CITY_BBOX, EPSG:4326).
 * - Support du format ESRI JSON (f=json) en plus de f=geojson pour compatibilité.
 * - NO_LOT dans le cadastre allégé a des espaces (ex. "4 516 943") — préservé tel quel.
 *
 * ## Loi 25 / anti-PII
 * La sortie ne contient QUE `noLot` (NO_LOT du cadastre allégé) et `citySlug` —
 * aucune donnée propriétaire ni PII.
 */

import { z } from "zod";
import {
  getGeoSourceInventory,
} from "@radar/sources";

// ─── Schémas GeoJSON minimaux ─────────────────────────────────────────────────

/** Properties exposées : uniquement l'identifiant public du lot (NO_LOT). */
export const LotProperties = z.object({
  noLot: z.string(),
  citySlug: z.string().optional(),
});
export type LotPropertiesT = z.infer<typeof LotProperties>;

const GeoJsonGeometry = z.object({
  type: z.string(),
  coordinates: z.unknown(),
});

export const LotFeature = z.object({
  type: z.literal("Feature"),
  geometry: GeoJsonGeometry.nullable(),
  properties: LotProperties,
});
export type LotFeatureT = z.infer<typeof LotFeature>;

export const LotFeatureCollection = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(LotFeature),
});
export type LotFeatureCollectionT = z.infer<typeof LotFeatureCollection>;

// ─── Schéma de la réponse brute ArcGIS ────────────────────────────────────────

/** Propriétés brutes retournées par le MapServer MRNF (peut contenir PII). */
const ArcGisProperties = z.record(z.unknown());

const ArcGisFeature = z.object({
  type: z.literal("Feature"),
  geometry: GeoJsonGeometry.nullable(),
  properties: ArcGisProperties,
});

const ArcGisFeatureCollection = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(ArcGisFeature),
});

// ─── Schéma ESRI JSON (f=json, format alternatif) ─────────────────────────────

/** Feature au format ESRI JSON brut (attributes + geometry). */
const EsriJsonFeature = z.object({
  attributes: ArcGisProperties,
  geometry: z.unknown().optional(),
});

/** Réponse ESRI JSON avec geometryType + features. */
const EsriJsonResponse = z.object({
  features: z.array(EsriJsonFeature),
  geometryType: z.string().optional(),
});

// ─── Bbox par défaut des villes pilotes (EPSG:4326) ───────────────────────────
//
// Anti-invention : bboxes approximatives documentées depuis les coordonnées
// géographiques réelles des périmètres municipaux (OpenStreetMap/Statistique Canada).
// Format : [minLon, minLat, maxLon, maxLat].
// Toutes les villes sont dans la région de Montérégie-Ouest (QC).

const CITY_BBOX_4326: Record<string, [number, number, number, number]> = {
  // Salaberry-de-Valleyfield — île principale + centre urbain.
  // Confirmé : 15/15 lots HTTP 200 avec cette bbox (2026-05-25, 2026-06-10).
  "salaberry-de-valleyfield": [-74.16, 45.24, -74.07, 45.32],

  // Beauharnois — MRC Beauharnois-Salaberry, rive sud.
  "beauharnois": [-73.96, 45.31, -73.85, 45.39],

  // Sainte-Catherine — Montérégie, rive sud Fleuve.
  "sainte-catherine": [-73.59, 45.39, -73.54, 45.44],

  // Delson — Montérégie, MRC Roussillon.
  "delson": [-73.57, 45.36, -73.51, 45.40],

  // Saint-Constant — Montérégie, MRC Roussillon.
  "saint-constant": [-73.60, 45.35, -73.52, 45.40],

  // Saint-Damase — Montérégie, MRC Les Maskoutains.
  "saint-damase": [-72.85, 45.56, -72.72, 45.63],
};

// ─── Options du service ────────────────────────────────────────────────────────

export interface LotsForCityOpts {
  /** Bounding-box [minLon,minLat,maxLon,maxLat] en EPSG:4326. Optionnel. */
  bbox?: [number, number, number, number];
  /** Nombre max de features à retourner (défaut 200). */
  limit?: number;
  /** Injectable pour tests (défaut = global fetch). */
  fetchImpl?: typeof fetch;
}

export interface LotsForCityResult {
  ok: boolean;
  citySlug: string;
  source: "donnees-quebec" | "none";
  reason?: string;
  featureCollection: LotFeatureCollectionT;
}

// ─── Service ──────────────────────────────────────────────────────────────────

/** FeatureCollection vide réutilisable. */
const EMPTY_FC: LotFeatureCollectionT = {
  type: "FeatureCollection",
  features: [],
};

/**
 * Construit le JSON geometry envelope ArcGIS à partir d'une bbox EPSG:4326.
 */
function bboxToEsriEnvelope(
  bbox: [number, number, number, number],
): string {
  return JSON.stringify({
    xmin: bbox[0],
    ymin: bbox[1],
    xmax: bbox[2],
    ymax: bbox[3],
    spatialReference: { wkid: 4326 },
  });
}

/**
 * Normalise un lot brut (GeoJSON ou ESRI JSON) vers LotFeatureT.
 * Extrait UNIQUEMENT NO_LOT → pas de PII.
 */
function normalizeFeature(
  f: { type?: string; geometry?: unknown; properties?: Record<string, unknown>; attributes?: Record<string, unknown> },
  citySlug: string,
): LotFeatureT {
  // Support format ESRI JSON (attributes) ou GeoJSON (properties)
  const props = (f.properties ?? f.attributes ?? {}) as Record<string, unknown>;
  const rawNoLot = props["NO_LOT"];
  const noLot = String(rawNoLot ?? "");

  // Geometry : GeoJSON feature a geometry, ESRI JSON feature peut en avoir une
  // mais on la passe uniquement si elle a le bon shape.
  const geom = (f as { geometry?: unknown }).geometry;
  const typedGeom =
    geom != null &&
    typeof geom === "object" &&
    "type" in (geom as object) &&
    "coordinates" in (geom as object)
      ? (geom as { type: string; coordinates: unknown })
      : null;

  return {
    type: "Feature" as const,
    geometry: typedGeom,
    properties: { noLot, citySlug },
  };
}

/**
 * Retourne les lots cadastraux pour `citySlug`.
 * - Ville avec `lots.availability === "donnees-quebec"` → requête MRNF bornée par bbox.
 * - Ville absente ou sans source → FeatureCollection vide + raison.
 *
 * La requête est toujours bornée par bbox (opts.bbox ou défaut CITY_BBOX_4326).
 * Sans bbox le MapServer MRNF rejette `where=1=1` avec HTTP 404.
 */
export async function lotsForCity(
  citySlug: string,
  opts: LotsForCityOpts = {},
): Promise<LotsForCityResult> {
  const { limit = 200, fetchImpl = fetch } = opts;

  const inventory = getGeoSourceInventory(citySlug);

  if (!inventory) {
    return {
      ok: false,
      citySlug,
      source: "none",
      reason: `Ville inconnue dans l'inventaire geo : "${citySlug}"`,
      featureCollection: EMPTY_FC,
    };
  }

  if (inventory.lots.availability !== "donnees-quebec") {
    return {
      ok: false,
      citySlug,
      source: "none",
      reason: `Pas de source lots pour "${citySlug}" (availability=${inventory.lots.availability})`,
      featureCollection: EMPTY_FC,
    };
  }

  const url = inventory.lots.url;
  if (!url) {
    return {
      ok: false,
      citySlug,
      source: "none",
      reason: `URL manquante dans l'inventaire pour "${citySlug}"`,
      featureCollection: EMPTY_FC,
    };
  }

  // Bbox : opts.bbox prioritaire, sinon défaut par ville.
  const bbox: [number, number, number, number] | undefined =
    opts.bbox ?? CITY_BBOX_4326[citySlug];

  if (!bbox) {
    return {
      ok: false,
      citySlug,
      source: "donnees-quebec",
      reason: `Bbox manquante pour "${citySlug}" — requête MRNF impossible sans bornes spatiales`,
      featureCollection: EMPTY_FC,
    };
  }

  // Construction de la requête ArcGIS REST bornée par bbox.
  // inSR=4326 : on envoie la bbox en WGS84.
  // outSR=4326 : on reçoit les géométries en WGS84.
  // f=geojson : le serveur retourne directement un FeatureCollection GeoJSON.
  const params = new URLSearchParams({
    geometry: bboxToEsriEnvelope(bbox),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    outSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "NO_LOT",
    returnGeometry: "true",
    f: "geojson",
    resultRecordCount: String(limit),
  });

  const queryUrl = `${url}?${params.toString()}`;
  const response = await fetchImpl(queryUrl);

  if (!response.ok) {
    return {
      ok: false,
      citySlug,
      source: "donnees-quebec",
      reason: `Upstream MRNF returned HTTP ${response.status}`,
      featureCollection: EMPTY_FC,
    };
  }

  const raw: unknown = await response.json();

  // Tentative 1 : format GeoJSON natif (f=geojson)
  const parsedGeoJson = ArcGisFeatureCollection.safeParse(raw);
  if (parsedGeoJson.success) {
    const features: LotFeatureT[] = parsedGeoJson.data.features.map((f) =>
      normalizeFeature(
        {
          type: f.type,
          geometry: f.geometry,
          properties: f.properties as Record<string, unknown>,
        },
        citySlug,
      ),
    );
    return {
      ok: true,
      citySlug,
      source: "donnees-quebec",
      featureCollection: { type: "FeatureCollection", features },
    };
  }

  // Tentative 2 : format ESRI JSON (f=json, fallback)
  const parsedEsri = EsriJsonResponse.safeParse(raw);
  if (parsedEsri.success) {
    const features: LotFeatureT[] = parsedEsri.data.features.map((f) =>
      normalizeFeature(
        { attributes: f.attributes as Record<string, unknown> },
        citySlug,
      ),
    );
    return {
      ok: true,
      citySlug,
      source: "donnees-quebec",
      featureCollection: { type: "FeatureCollection", features },
    };
  }

  return {
    ok: false,
    citySlug,
    source: "donnees-quebec",
    reason: `Réponse ArcGIS inattendue : ${parsedGeoJson.error.message}`,
    featureCollection: EMPTY_FC,
  };
}
