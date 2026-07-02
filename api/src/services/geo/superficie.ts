/**
 * Calcul de superficie depuis une géométrie GeoJSON publique (m²).
 *
 * Extrait de routes/geo-lots.ts (feat/geo-lots-enrich-zone) pour être partagé
 * avec l'enrichissement des collections OGC (lot-zone-enrichment.ts).
 * Comportement inchangé pour les Polygon ; ajout du support MultiPolygon
 * (somme des anneaux extérieurs).
 *
 * Anti-invention : approximation planaire locale documentée, null si la
 * géométrie est absente, non-polygonale ou dégénérée.
 */

export interface SuperficieGeometry {
  type: string;
  coordinates: unknown;
}

/**
 * Calcule l'aire d'un anneau de polygone (coordonnées [lon, lat] en degrés)
 * via la formule de Shoelace dans l'espace géographique projeté en mètres.
 *
 * Approximation locale : Δlon * cos(lat_moy) pour avoir des mètres est suffisante
 * pour des lots < 1 km². Erreur < 0.1 % sur le territoire QC (lat ~45°).
 * Anti-invention : retourne null si l'anneau a moins de 3 points.
 */
export function ringAreaM2(ring: number[][], latMidDeg: number): number | null {
  if (ring.length < 3) return null;

  const DEG_TO_RAD = Math.PI / 180;
  // Mètres par degré de latitude (constant à ~111 320 m/°)
  const metersPerDegLat = 111_320;
  // Mètres par degré de longitude (varie avec lat)
  const metersPerDegLon = 111_320 * Math.cos(latMidDeg * DEG_TO_RAD);

  // Shoelace dans l'espace local (x = lon * metersPerDegLon, y = lat * metersPerDegLat)
  let area = 0;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i]![0]! * metersPerDegLon;
    const yi = ring[i]![1]! * metersPerDegLat;
    const xj = ring[j]![0]! * metersPerDegLon;
    const yj = ring[j]![1]! * metersPerDegLat;
    area += (xj + xi) * (yj - yi);
  }
  return Math.abs(area) / 2;
}

/** Aire (m²) de l'anneau extérieur d'un polygone GeoJSON. null si invalide. */
function outerRingAreaM2(coords: number[][][]): number | null {
  const outerRing = coords[0];
  if (!outerRing || outerRing.length < 3) return null;

  // Latitude médiane pour la projection
  const lats = outerRing.map((pt) => pt[1]!);
  const latMid = (Math.min(...lats) + Math.max(...lats)) / 2;

  return ringAreaM2(outerRing, latMid);
}

/**
 * Estime la superficie en m² depuis une géométrie GeoJSON Polygon ou MultiPolygon.
 * - Prend les anneaux extérieurs uniquement (anti-invention : ne soustrait pas
 *   les trous, ce qui est conservateur).
 * - MultiPolygon : somme des anneaux extérieurs de chaque polygone.
 * - Retourne null si la géométrie est null, non-polygonale, ou invalide.
 * - Arrondi à 1 décimale (précision suffisante pour la fiche lot).
 */
export function superficieFromGeometry(
  geom: SuperficieGeometry | null,
): number | null {
  if (!geom) return null;

  if (geom.type === "Polygon") {
    const area = outerRingAreaM2(geom.coordinates as number[][][]);
    if (area === null) return null;
    return Math.round(area * 10) / 10;
  }

  if (geom.type === "MultiPolygon") {
    const polys = geom.coordinates as number[][][][];
    if (!Array.isArray(polys) || polys.length === 0) return null;
    let total = 0;
    let found = false;
    for (const poly of polys) {
      const area = outerRingAreaM2(poly);
      if (area !== null) {
        total += area;
        found = true;
      }
    }
    if (!found) return null;
    return Math.round(total * 10) / 10;
  }

  return null;
}
