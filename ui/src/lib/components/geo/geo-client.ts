/**
 * Client API pour les endpoints geo-features (G3 WP géo-intégration).
 *
 * GET /api/geo/cities       → liste des villes avec données géo
 * GET /api/geo/features/:city → FeatureCollection fusionnée zones+lots+opps
 *
 * Loi 25 : aucune PII dans la réponse.
 */

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

export interface GeoFeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}

export interface GeoJsonFeature {
  type: "Feature";
  geometry: GeoJsonGeometry | null;
  properties: Record<string, unknown>;
}

export interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}

export interface GeoFeaturesResponse {
  ok: boolean;
  citySlug: string;
  zoneCount: number;
  lotCount: number;
  opportuniteCount: number;
  zones: GeoFeatureCollection;
  lots: GeoFeatureCollection;
  opportunites: GeoFeatureCollection;
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
