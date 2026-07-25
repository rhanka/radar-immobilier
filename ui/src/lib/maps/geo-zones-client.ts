import type { GeoJsonGeometry } from "./cadastre-geojson-source.js";
import {
  sanitizeProvenanceProperties,
  type FeatureProof,
  type ImmoZoneLotProvenance,
} from "./geo-provenance.js";
import { fetchWithTimeout } from "$lib/net/fetch-with-timeout.js";

export type GeoZoneResolutionStatus = "official" | "fallback" | "missing";
export type GeoZoneGeometryStatus =
  | "official"
  | "lot-union-fallback"
  | "text-only"
  | "missing";

export interface GeoZoneLotRef {
  noLot: string;
  citySlug: string;
}

export interface GeoZoneProperties {
  code: string;
  citySlug: string;
  geometryStatus: GeoZoneGeometryStatus;
  confidence: number;
  source: "official-zone" | "lot-zone-fallback" | "signal-designated";
  lotCount: number;
  lots: GeoZoneLotRef[];
  label?: string;
  /** Opaque geo envelope, preserved verbatim when supplied. */
  proof?: FeatureProof;
  /** Opaque geo envelope, preserved verbatim when supplied. */
  immo_zone_lot_provenance?: ImmoZoneLotProvenance;
  /**
   * Famille/kind de la zone quand la source l'expose (ex. "habitation",
   * lettre canonique "H", code court geo "CO") — sert à la teinte des aplats
   * (zone-kind-style).
   */
  kind?: string | null;
  /**
   * Libellé d'affectation du sol quand la source l'expose (ex. « Conservation »,
   * « CV - Résidentielle de faible densité ») — résolu en PRIORITÉ pour la
   * teinte par famille (zone-kind-style), plus fiable que le code `kind`.
   */
  affectation?: string | null;
  /** Lien grille de zonage PDF quand la source l'expose (preuve). */
  grillePdfUrl?: string;
  /**
   * Millésime (année) du règlement de zonage porteur PAR ZONE quand la source
   * l'expose (ex. "2008") — axe millésime de la fiche/filtre. null si absent.
   */
  reglementMillesime?: string | null;
  /** Numéro du règlement de zonage porteur (ex. "2008-102") quand la source l'expose. */
  reglementNumero?: string | null;
  /** UI-derived : couleur résolue de l'aplat par kind (peinture MapLibre) — jamais persistée. */
  kindColor?: string;
  /** UI-derived : zone SÉLECTIONNÉE (exergue orange C3) — jamais persistée. */
  isSelected?: boolean;
}

export interface GeoZoneFeature {
  type: "Feature";
  geometry: GeoJsonGeometry | null;
  properties: GeoZoneProperties;
}

export interface GeoZoneFeatureCollection {
  type: "FeatureCollection";
  features: GeoZoneFeature[];
}

export interface GeoZonesResponse {
  ok: boolean;
  citySlug: string;
  source: "official" | "lot-union-fallback" | "none";
  resolutionStatus: GeoZoneResolutionStatus;
  geometryStatus: GeoZoneGeometryStatus;
  zoneCount: number;
  warnings: string[];
  featureCollection: GeoZoneFeatureCollection;
}

export interface FetchGeoZonesOptions {
  fallback?: "lots";
  limit?: number;
  bbox?: [number, number, number, number];
  baseUrl?: string;
  /** Signal d'annulation externe (anti-course au changement de ville). */
  signal?: AbortSignal;
  /** Timeout requête (ms). Défaut : `DEFAULT_REQUEST_TIMEOUT_MS`. */
  timeoutMs?: number;
}

export function resolveGeoZonesUrl(
  citySlug: string,
  opts: FetchGeoZonesOptions = {},
): string {
  const baseUrl = opts.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? "";
  const base = baseUrl ? baseUrl.replace(/\/$/, "") : "";
  const path = `/api/geo/${encodeURIComponent(citySlug)}/zones`;
  const params = new URLSearchParams();
  if (opts.fallback) params.set("fallback", opts.fallback);
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.bbox) params.set("bbox", opts.bbox.join(","));
  const qs = params.toString();
  return `${base}${path}${qs ? `?${qs}` : ""}`;
}

/**
 * Re-valide les enveloppes preuve/provenance d'une réponse `/api/geo/:city/zones`.
 *
 * Ce chemin de repli ne construit pas ses features (contrairement au chemin OGC
 * prioritaire, `geoZonesResponseFromCollection`) : il désérialise un JSON. Il
 * lui applique donc la MÊME validation positive versionnée avant que quoi que
 * ce soit n'atteigne un composant — enveloppe non conforme écartée en entier,
 * toutes les autres propriétés conservées telles quelles (non-blackout).
 */
export function sanitizeGeoZonesResponse(response: GeoZonesResponse): GeoZonesResponse {
  const features = response?.featureCollection?.features;
  if (!Array.isArray(features)) return response;
  return {
    ...response,
    featureCollection: {
      ...response.featureCollection,
      features: features.map((feature): GeoZoneFeature => {
        if (!feature || typeof feature.properties !== "object" || feature.properties === null) return feature;
        return { ...feature, properties: sanitizeProvenanceProperties(feature.properties as unknown as Record<string, unknown>) as unknown as GeoZoneProperties };
      }),
    },
  };
}

export async function fetchGeoZones(
  citySlug: string,
  opts: FetchGeoZonesOptions = {},
): Promise<GeoZonesResponse> {
  const res = await fetchWithTimeout(resolveGeoZonesUrl(citySlug, opts), {
    signal: opts.signal,
    timeoutMs: opts.timeoutMs,
  });
  if (!res.ok) {
    throw new Error(`geo-zones HTTP ${res.status} for ${citySlug}`);
  }
  return sanitizeGeoZonesResponse((await res.json()) as GeoZonesResponse);
}
