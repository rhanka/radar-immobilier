/**
 * zone-membership — résolution PURE « quel code de zone contient ce point ».
 *
 * Contrat caméra « lot suivant » : sélectionner un autre lot RECENTRE la
 * caméra en GARDANT le zoom — sauf si le lot appartient à une AUTRE zone
 * (le cadrage existant, qui peut changer le zoom, reste alors permis). Il faut
 * donc savoir dans quelle zone tombe un lot. Les refs `zone.properties.lots`
 * sont souvent vides (pas de join lots côté API) : on résout GÉOMÉTRIQUEMENT,
 * par appartenance du centre du lot au polygone de zone (ray-casting).
 *
 * Testable offline sans MapLibre/WebGL. Anti-invention : une géométrie
 * absente/non surfacique ne « contient » rien ; aucun code de zone n'est
 * fabriqué — indéterminé ⇒ `null`, l'appelant décide du repli.
 */

import type { GeoJsonGeometry } from "./cadastre-geojson-source.js";

/** Position WGS-84 [lon, lat]. */
export type LngLatPoint = [number, number];

/** Ray-casting pair à pair (even-odd) sur un anneau GeoJSON [ [lon,lat], … ]. */
function ringContains(ring: ReadonlyArray<ReadonlyArray<number>>, point: LngLatPoint): boolean {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]?.[0];
    const yi = ring[i]?.[1];
    const xj = ring[j]?.[0];
    const yj = ring[j]?.[1];
    if (
      typeof xi !== "number" ||
      typeof yi !== "number" ||
      typeof xj !== "number" ||
      typeof yj !== "number"
    ) {
      continue;
    }
    const crosses =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Contenance d'un polygone GeoJSON (anneau extérieur MOINS ses trous). */
function polygonContains(
  coordinates: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>,
  point: LngLatPoint,
): boolean {
  const outer = coordinates[0];
  if (!Array.isArray(outer) || !ringContains(outer, point)) return false;
  for (let k = 1; k < coordinates.length; k += 1) {
    const hole = coordinates[k];
    if (Array.isArray(hole) && ringContains(hole, point)) return false;
  }
  return true;
}

/**
 * True si la géométrie GeoJSON (Polygon / MultiPolygon / GeometryCollection)
 * contient le point. Les géométries non surfaciques (Point, LineString…) et
 * nulles ne contiennent rien.
 */
export function geometryContainsPoint(
  geometry: GeoJsonGeometry | null | undefined,
  point: LngLatPoint,
): boolean {
  if (!geometry) return false;
  if (geometry.type === "Polygon") {
    return polygonContains(
      geometry.coordinates as ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>,
      point,
    );
  }
  if (geometry.type === "MultiPolygon") {
    const polygons = geometry.coordinates as ReadonlyArray<
      ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>
    >;
    return polygons.some((poly) => polygonContains(poly, point));
  }
  if (geometry.type === "GeometryCollection") {
    const geometries = (geometry as { geometries?: unknown[] }).geometries;
    return (
      Array.isArray(geometries) &&
      geometries.some((g) => geometryContainsPoint(g as GeoJsonGeometry, point))
    );
  }
  return false;
}

/** Feature de zone minimale pour la résolution (géométrie + code). */
export interface ZoneMembershipFeature {
  geometry: GeoJsonGeometry | null;
  properties: { code: string };
}

/**
 * Code de la PREMIÈRE zone dont la géométrie contient le point, `null` si
 * aucune (ou si les zones n'ont pas de géométrie exploitable). Déterministe :
 * ordre de la collection (zones officielles disjointes ⇒ au plus une).
 */
export function zoneCodeAtPoint(
  zones: ReadonlyArray<ZoneMembershipFeature> | null | undefined,
  point: LngLatPoint,
): string | null {
  if (!zones) return null;
  for (const zone of zones) {
    if (geometryContainsPoint(zone.geometry, point)) return zone.properties.code;
  }
  return null;
}
