/**
 * geometry-bounds — calcul PUR de la bounding box WGS-84 d'une géométrie GeoJSON.
 *
 * Extrait pour le zoom caméra de la vue Signaux :
 *  - bug #12 (zoom sur une zone) : `fitBounds` sur l'étendue de la zone sélectionnée ;
 *  - bug #13 (zoom à l'échelle province) : retour à l'étendue provinciale.
 *
 * Testable offline sans MapLibre/WebGL (indisponible en CI headless).
 *
 * Anti-invention : on ne lit QUE les coordonnées GeoJSON fournies. Aucun
 * arrondi de complaisance, aucune valeur fabriquée — une géométrie vide/nulle
 * renvoie `null` et l'appelant décide du repli (étendue province).
 */

import type { GeoJsonGeometry } from "./cadastre-geojson-source.js";

/** bbox WGS-84 au format MapLibre LngLatBounds : [[minLon, minLat], [maxLon, maxLat]]. */
export type LngLatBoundsTuple = [[number, number], [number, number]];

interface MutableBounds {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/**
 * Étendue approximative de la province de Québec (repli vue province, bug #13).
 * Cohérent avec `computeBbox([])` de maps-data.ts (extent fallback provincial).
 */
export const QUEBEC_PROVINCE_BOUNDS: LngLatBoundsTuple = [
  [-79.5, 44.9],
  [-57.0, 63.0],
];

function accumulateCoords(coords: unknown, acc: MutableBounds): void {
  if (!Array.isArray(coords)) return;
  // Position GeoJSON = [lon, lat, ...]. On la reconnaît à 2 premiers nombres.
  if (
    coords.length >= 2 &&
    typeof coords[0] === "number" &&
    typeof coords[1] === "number"
  ) {
    const lon = coords[0];
    const lat = coords[1];
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      if (lon < acc.minLon) acc.minLon = lon;
      if (lon > acc.maxLon) acc.maxLon = lon;
      if (lat < acc.minLat) acc.minLat = lat;
      if (lat > acc.maxLat) acc.maxLat = lat;
    }
    return;
  }
  for (const child of coords) accumulateCoords(child, acc);
}

/**
 * Bounding box d'une géométrie GeoJSON unique (Point, LineString, Polygon,
 * MultiPolygon, GeometryCollection…). Renvoie `null` si la géométrie est nulle
 * ou ne contient aucune coordonnée finie.
 */
export function geometryBounds(
  geometry: GeoJsonGeometry | null | undefined,
): LngLatBoundsTuple | null {
  if (!geometry) return null;

  const acc: MutableBounds = {
    minLon: Infinity,
    minLat: Infinity,
    maxLon: -Infinity,
    maxLat: -Infinity,
  };

  if (geometry.type === "GeometryCollection") {
    const geometries = (geometry as { geometries?: unknown[] }).geometries;
    if (Array.isArray(geometries)) {
      for (const g of geometries) {
        const inner = geometryBounds(g as GeoJsonGeometry);
        if (inner) {
          if (inner[0][0] < acc.minLon) acc.minLon = inner[0][0];
          if (inner[0][1] < acc.minLat) acc.minLat = inner[0][1];
          if (inner[1][0] > acc.maxLon) acc.maxLon = inner[1][0];
          if (inner[1][1] > acc.maxLat) acc.maxLat = inner[1][1];
        }
      }
    }
  } else {
    accumulateCoords(geometry.coordinates, acc);
  }

  if (
    !Number.isFinite(acc.minLon) ||
    !Number.isFinite(acc.minLat) ||
    !Number.isFinite(acc.maxLon) ||
    !Number.isFinite(acc.maxLat)
  ) {
    return null;
  }

  return [
    [acc.minLon, acc.minLat],
    [acc.maxLon, acc.maxLat],
  ];
}

/**
 * Union des bounding box de plusieurs géométries. Renvoie `null` si aucune
 * géométrie ne porte de coordonnée finie.
 */
export function unionBounds(
  geometries: ReadonlyArray<GeoJsonGeometry | null | undefined>,
): LngLatBoundsTuple | null {
  let merged: LngLatBoundsTuple | null = null;
  for (const geometry of geometries) {
    const b = geometryBounds(geometry);
    if (!b) continue;
    if (!merged) {
      merged = [
        [b[0][0], b[0][1]],
        [b[1][0], b[1][1]],
      ];
    } else {
      if (b[0][0] < merged[0][0]) merged[0][0] = b[0][0];
      if (b[0][1] < merged[0][1]) merged[0][1] = b[0][1];
      if (b[1][0] > merged[1][0]) merged[1][0] = b[1][0];
      if (b[1][1] > merged[1][1]) merged[1][1] = b[1][1];
    }
  }
  return merged;
}

/** True si la bbox est un point unique (étendue nulle) — fitBounds doit alors flyTo. */
export function isDegenerateBounds(bounds: LngLatBoundsTuple): boolean {
  return bounds[0][0] === bounds[1][0] && bounds[0][1] === bounds[1][1];
}
