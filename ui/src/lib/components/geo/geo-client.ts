/**
 * Client API pour les endpoints geo-features (G3 WP géo-intégration).
 *
 * GET /api/geo/cities       → liste des villes avec données géo
 * GET /api/geo/features/:city → FeatureCollection fusionnée zones+lots+opps
 *
 * Loi 25 : aucune PII dans la réponse.
 */

import {
  readRegulatoryStatus,
  type RegulatoryStatusT,
} from "@radar/domain";

// ─────────────────────────────────────────────────────────────────────────────
// Types réponse API
// ─────────────────────────────────────────────────────────────────────────────

export interface GeoCityInfo {
  citySlug: string;
  zoneCount: number;
  lotCount: number;
  signalCount: number;
}

export interface GeoCitiesResponse {
  ok: boolean;
  cities: GeoCityInfo[];
}

export interface GeoFeatureCollection<
  TProperties extends Record<string, unknown> = Record<string, unknown>,
> {
  type: "FeatureCollection";
  features: GeoJsonFeature<TProperties>[];
}

export interface GeoJsonFeature<
  TProperties extends Record<string, unknown> = Record<string, unknown>,
> {
  type: "Feature";
  geometry: GeoJsonGeometry | null;
  properties: TProperties;
}

export interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}

export interface GeoRegulatoryFeatureProperties extends Record<string, unknown> {
  regulatoryStatus: RegulatoryStatusT | null;
  regulatoryMarking?: "Ferme" | "Anticipation";
}

export interface GeoZoneFeatureProperties extends GeoRegulatoryFeatureProperties {
  featureKind: "zone";
  anticipation: string | null;
}

export interface GeoOpportuniteFeatureProperties extends GeoRegulatoryFeatureProperties {
  featureKind: "opportunite";
  etape: string | null;
  regulatoryStatus: RegulatoryStatusT;
}

export interface GeoFeaturesResponse {
  ok: boolean;
  citySlug: string;
  zoneCount: number;
  lotCount: number;
  opportuniteCount: number;
  zones: GeoFeatureCollection<GeoZoneFeatureProperties>;
  lots: GeoFeatureCollection;
  opportunites: GeoFeatureCollection<GeoOpportuniteFeatureProperties>;
}

const REGULATORY_MARKING_LABELS: Record<
  RegulatoryStatusT,
  "Ferme" | "Anticipation"
> = {
  firm: "Ferme",
  anticipation: "Anticipation",
};

/**
 * Prépare les features consommées par GeoView. Le marquage lit exclusivement
 * le regulatoryStatus servi ; l'étape reste un axe de détail indépendant.
 */
export function buildGeoViewFeatures(response: GeoFeaturesResponse): GeoJsonFeature[] {
  const mark = <T extends GeoRegulatoryFeatureProperties>(
    feature: GeoJsonFeature<T>,
  ): GeoJsonFeature<T> => {
    if (feature.properties.regulatoryStatus === null) return feature;
    const status = readRegulatoryStatus({
      regulatoryStatus: feature.properties.regulatoryStatus,
    });
    return {
      ...feature,
      properties: {
        ...feature.properties,
        regulatoryMarking: REGULATORY_MARKING_LABELS[status],
      },
    };
  };

  return [
    ...response.zones.features.map(mark),
    ...response.lots.features,
    ...response.opportunites.features.map(mark),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers URL
// ─────────────────────────────────────────────────────────────────────────────

function apiBase(): string {
  const meta = import.meta as unknown as { env?: Record<string, string> };
  return meta.env?.VITE_API_BASE_URL ?? "";
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch fonctions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retourne la liste des villes ayant des données géo.
 */
export async function fetchGeoCities(): Promise<GeoCitiesResponse> {
  const url = `${apiBase()}/api/geo/cities`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`geo cities HTTP ${res.status}`);
  }
  return res.json() as Promise<GeoCitiesResponse>;
}

/**
 * Retourne la FeatureCollection fusionnée pour une ville.
 */
export async function fetchGeoFeatures(citySlug: string): Promise<GeoFeaturesResponse> {
  const url = `${apiBase()}/api/geo/features/${encodeURIComponent(citySlug)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`geo features HTTP ${res.status}`);
  }
  return res.json() as Promise<GeoFeaturesResponse>;
}
