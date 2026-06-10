/**
 * Service lots cadastraux — WP B slice-1 (zone → lot).
 *
 * Lit l'inventaire GeoSourceInventory pour une ville ; si
 * `lots.availability === "donnees-quebec"` interroge le MapServer ArcGIS MRNF
 * (Cadastre_allege) et retourne un FeatureCollection GeoJSON normalisé.
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

// ─── Options du service ────────────────────────────────────────────────────────

export interface LotsForCityOpts {
  /** Bounding-box [minX,minY,maxX,maxY] en EPSG:4326. Optionnel. */
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
 * Retourne les lots cadastraux pour `citySlug`.
 * - Ville avec `lots.availability === "donnees-quebec"` → requête MRNF.
 * - Ville absente ou sans source → FeatureCollection vide + raison.
 */
export async function lotsForCity(
  citySlug: string,
  opts: LotsForCityOpts = {},
): Promise<LotsForCityResult> {
  const { limit = 200, bbox, fetchImpl = fetch } = opts;

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

  // Construction de la requête ArcGIS REST
  const params = new URLSearchParams({
    where: "1=1",
    outFields: "NO_LOT",
    returnGeometry: "true",
    f: "geojson",
    resultRecordCount: String(limit),
  });

  if (bbox) {
    params.set(
      "geometry",
      JSON.stringify({
        xmin: bbox[0],
        ymin: bbox[1],
        xmax: bbox[2],
        ymax: bbox[3],
        spatialReference: { wkid: 4326 },
      }),
    );
    params.set("geometryType", "esriGeometryEnvelope");
    params.set("inSR", "4326");
    params.set("spatialRel", "esriSpatialRelIntersects");
  }

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
  const parsed = ArcGisFeatureCollection.safeParse(raw);

  if (!parsed.success) {
    return {
      ok: false,
      citySlug,
      source: "donnees-quebec",
      reason: `Réponse ArcGIS inattendue : ${parsed.error.message}`,
      featureCollection: EMPTY_FC,
    };
  }

  // Normalisation : on extrait UNIQUEMENT NO_LOT — pas de PII.
  const features: LotFeatureT[] = parsed.data.features.map((f) => {
    const noLot = String(
      (f.properties["NO_LOT"] as string | number | null | undefined) ?? "",
    );
    return {
      type: "Feature" as const,
      geometry: f.geometry,
      properties: { noLot, citySlug },
    };
  });

  return {
    ok: true,
    citySlug,
    source: "donnees-quebec",
    featureCollection: {
      type: "FeatureCollection",
      features,
    },
  };
}
