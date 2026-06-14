/**
 * Maps data helpers — pure functions for the three map views.
 *
 * Anti-invention policy: city/coordinate data comes exclusively from
 * QC_MUNICIPALITIES (GeoNames+MAMH CC-BY 4.0). Signal counts per city are
 * derived from real ontology DesignationEvent canonicals via
 * GET /api/signals/by-city. Cities without API data receive count=0 (honest
 * placeholder — never fabricated).
 *
 * Only cities with priorityRank (non-excluded, non-deprioritized) are shown
 * in the signal map.
 */

import { prioritizedCities } from "@radar/sources/municipalities";
import type { MunicipalityT } from "@radar/domain";
import type { SignalCityItem } from "$lib/signals/signals-by-city-client.js";
import type { GraphSignalCityItem } from "$lib/signals/graph-signals-by-city-client.js";

/**
 * The pilot city for which we have real signals. Kept as a named export for
 * use in templates (e.g. label the pilot city on the SVG map).
 */
export const PILOT_CITY_SLUG = "salaberry-de-valleyfield";

/** A city enriched with its signal count for the map view. */
export interface CityMapEntry {
  municipality: MunicipalityT;
  /**
   * Count of DesignationEvent canonicals (rezoning changes) from the real
   * ontology project state (GET /api/signals/by-city), 0 when no data.
   */
  signalCount6m: number;
  /**
   * Breakdown of signal count by node type (e.g. { Signal: 3, DesignationEvent: 2 }).
   * Empty object when data is not yet available or city has no signals.
   * Used to compute filtered counts when excludedTypes is non-empty.
   */
  countsByType: Record<string, number>;
  /**
   * Count of zonage signals only (from GET /api/graph-signals/by-city).
   * DesignationEvent always counts as zonage; Signal only if its category
   * is in ZONAGE_CATEGORIES (server-side). 0 when no data.
   * Used as the base count when « Zonage uniquement » toggle is ON.
   */
  zonageCount: number;
}

/**
 * Build city map entries from the real API response.
 *
 * Anti-invention: signal counts come exclusively from the API. Cities absent
 * from the API response (no project state, or stale state > 6 months) get
 * count=0 — never fabricated. City/coordinate data from QC_MUNICIPALITIES.
 *
 * @param apiItems — items from GET /api/signals/by-city (may be empty on
 *   first deploy, before any city has been seeded).
 * @param graphItems — optional items from GET /api/graph-signals/by-city
 *   (provides countsByType breakdown per city).
 * @param options.maxCities — limit the number of returned cities.
 */
export function buildCityMapEntries(
  apiItems: readonly SignalCityItem[],
  graphItems: readonly GraphSignalCityItem[] = [],
  options: { maxCities?: number } = {},
): CityMapEntry[] {
  const cities = prioritizedCities();
  const limit = options.maxCities ?? cities.length;

  // Index API items by city slug for O(1) lookup.
  const countByCitySlug = new Map<string, number>(
    apiItems.map((item) => [item.citySlug, item.designationEventCount]),
  );

  // Index graph items by city slug for countsByType and zonageCount lookup.
  const countsByTypeByCitySlug = new Map<string, Record<string, number>>(
    graphItems.map((item) => [item.citySlug, item.countsByType]),
  );
  const zonageCountByCitySlug = new Map<string, number>(
    graphItems.map((item) => [item.citySlug, item.zonageCount ?? 0]),
  );

  return cities.slice(0, limit).map((m) => ({
    municipality: m,
    signalCount6m: countByCitySlug.get(m.slug) ?? 0,
    countsByType: countsByTypeByCitySlug.get(m.slug) ?? {},
    zonageCount: zonageCountByCitySlug.get(m.slug) ?? 0,
  }));
}

/**
 * Return the SVG viewport bounding box (minLon, minLat, maxLon, maxLat) that
 * encompasses all provided cities with a small padding margin.
 */
export function computeBbox(cities: MunicipalityT[]): {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
} {
  if (cities.length === 0) {
    // Québec province approximate extent (fallback)
    return { minLon: -79.5, minLat: 44.9, maxLon: -57.0, maxLat: 63.0 };
  }
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const c of cities) {
    if (c.lon < minLon) minLon = c.lon;
    if (c.lon > maxLon) maxLon = c.lon;
    if (c.lat < minLat) minLat = c.lat;
    if (c.lat > maxLat) maxLat = c.lat;
  }
  const padLon = (maxLon - minLon) * 0.05 + 0.5;
  const padLat = (maxLat - minLat) * 0.05 + 0.3;
  return {
    minLon: minLon - padLon,
    minLat: minLat - padLat,
    maxLon: maxLon + padLon,
    maxLat: maxLat + padLat,
  };
}

/**
 * Project WGS-84 (lon, lat) into SVG pixel space given a bounding box and
 * SVG viewport size. Y is inverted (SVG top = high lat).
 */
export function projectToSvg(
  lon: number,
  lat: number,
  bbox: ReturnType<typeof computeBbox>,
  width: number,
  height: number,
): { x: number; y: number } {
  const { minLon, minLat, maxLon, maxLat } = bbox;
  const x = ((lon - minLon) / (maxLon - minLon)) * width;
  const y = ((maxLat - lat) / (maxLat - minLat)) * height;
  return { x, y };
}

/**
 * Signal-count color tier for map dot rendering.
 * Returns a Tailwind fill class.
 */
export function signalCountTier(count: number): {
  fill: string;
  label: string;
} {
  if (count === 0) return { fill: "fill-slate-300", label: "Aucun signal" };
  if (count <= 2) return { fill: "fill-amber-400", label: `${count} signal${count > 1 ? "s" : ""}` };
  if (count <= 5) return { fill: "fill-orange-500", label: `${count} signaux` };
  return { fill: "fill-red-500", label: `${count} signaux` };
}

/**
 * Human-readable signal type label.
 */
export const SIGNAL_TYPE_LABEL: Record<string, string> = {
  "residential-rezoning": "Rezonage résidentiel",
  "cptaq": "CPTAQ",
  "ppcmoi": "PPCMOI",
  "plan-urbanisme": "Plan d'urbanisme",
  "public-consultation": "Consultation publique",
  "grid-cos-modification": "Modification grille/COS",
  "derogation-relevant": "Dérogation pertinente",
  "derogation-irrelevant": "Dérogation non pertinente",
};

/**
 * Confidence badge tone for the evaluation view.
 */
export const CONFIDENCE_TONE: Record<string, "success" | "warning" | "error"> = {
  high: "success",
  medium: "warning",
  low: "error",
};
