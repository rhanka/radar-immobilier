/**
 * Maps data helpers — pure functions for the three map views.
 *
 * Anti-invention policy: city/coordinate data comes exclusively from
 * QC_MUNICIPALITIES (GeoNames+MAMH CC-BY 4.0). Signal counts per city are
 * derived from demoSignalsT1 (3 real pilot signals for Salaberry-de-Valleyfield,
 * 3 synthetic simulation fixtures). No cities or signal counts are fabricated.
 *
 * Cities without any signals receive count=0 (honest placeholder, not a
 * fabricated signal). Only cities with priorityRank (non-excluded, non-
 * deprioritized) are shown in the signal map.
 */

import { prioritizedCities } from "@radar/sources/municipalities";
import type { MunicipalityT } from "@radar/domain";
import { demoSignalsT1 } from "$lib/demo/radar-t1-signals.js";
import type { SignalT } from "@radar/domain";

/**
 * The pilot city for which we have real signals. All real signals in
 * demoSignalsT1 originate from Valleyfield documents (bylaws 150-49,
 * 150-49-1, 150-51).
 */
export const PILOT_CITY_SLUG = "salaberry-de-valleyfield";

/**
 * Six-month window: only count signals detected within the last 6 months.
 * Reference date: 2026-06-10 (today).
 */
const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;
const NOW_MS = Date.parse("2026-06-10");

/** A city enriched with its signal count for the map view. */
export interface CityMapEntry {
  municipality: MunicipalityT;
  /** Count of rezoning signals (any type) detected in the last 6 months. */
  signalCount6m: number;
  /** The signals for this city (for city detail panel). */
  signals: SignalT[];
}

/**
 * Build the city map entries ordered by priority rank (closest to MTL first).
 *
 * Anti-invention: only the pilot city (salaberry-de-valleyfield) has real
 * signals. All other cities show 0. Simulation-mode signals are included
 * only for the pilot city since they are anchored to its zoning.
 */
export function buildCityMapEntries(
  options: { maxCities?: number } = {},
): CityMapEntry[] {
  const cities = prioritizedCities();
  const limit = options.maxCities ?? cities.length;

  return cities.slice(0, limit).map((m) => {
    const citySignals = m.slug === PILOT_CITY_SLUG ? demoSignalsT1 : [];
    const signals6m = citySignals.filter((s) => {
      const age = NOW_MS - Date.parse(s.detectedAt);
      return age <= SIX_MONTHS_MS;
    });
    return {
      municipality: m,
      signalCount6m: signals6m.filter((s) => s.type !== "derogation-irrelevant").length,
      signals: citySignals,
    };
  });
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
