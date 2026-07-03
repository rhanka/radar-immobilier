import type { GeoJsonGeometry } from "./cadastre-geojson-source.js";
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
  /**
   * Famille/kind de la zone quand la source l'expose (ex. "habitation",
   * lettre canonique "H") — sert à la teinte des aplats (zone-kind-style).
   */
  kind?: string | null;
  /** Lien grille de zonage PDF quand la source l'expose (preuve). */
  grillePdfUrl?: string;
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
  return (await res.json()) as GeoZonesResponse;
}
