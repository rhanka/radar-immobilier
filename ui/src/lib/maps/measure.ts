/**
 * measure — calculs PURS de l'outil « mesurer une distance » de la carte
 * (GeoCityMapBase), façon Google Maps.
 *
 *  - distance GÉODÉSIQUE entre deux points WGS-84 (haversine, rayon moyen
 *    terrestre 6 371 000 m) ;
 *  - cumul le long d'une polyligne de mesure ;
 *  - formatage FR (« 340 m » / « 1,2 km ») ;
 *  - construction des GeoJSON des sources `measure-line` / `measure-points`.
 *
 * Testable offline sans MapLibre/WebGL (indisponible en CI headless).
 */

/** Position WGS-84 au format GeoJSON / MapLibre : [lng, lat]. */
export type LngLatTuple = [number, number];

/** Rayon moyen terrestre (m) — convention haversine usuelle. */
const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Distance géodésique (m) entre deux positions [lng, lat] — formule
 * de haversine sur sphère de rayon moyen 6 371 km. Précision ≪ 0,5 % aux
 * échelles municipales visées, largement suffisante pour une mesure carte.
 */
export function haversineMeters(a: LngLatTuple, b: LngLatTuple): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const dPhi = toRadians(lat2 - lat1);
  const dLambda = toRadians(lng2 - lng1);
  const sinDPhi = Math.sin(dPhi / 2);
  const sinDLambda = Math.sin(dLambda / 2);
  const h =
    sinDPhi * sinDPhi + Math.cos(phi1) * Math.cos(phi2) * sinDLambda * sinDLambda;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Longueur cumulée (m) de la polyligne : somme des segments consécutifs. */
export function totalDistanceMeters(points: readonly LngLatTuple[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineMeters(points[i - 1], points[i]);
  }
  return total;
}

/** Longueur (m) du DERNIER segment de la polyligne (0 si < 2 points). */
export function lastSegmentMeters(points: readonly LngLatTuple[]): number {
  if (points.length < 2) return 0;
  return haversineMeters(points[points.length - 2], points[points.length - 1]);
}

/**
 * Formatage FR d'une distance : mètres entiers sous 1 km (« 340 m »), sinon
 * kilomètres à 1 décimale, virgule décimale, sans décimale inutile
 * (« 1,2 km », « 2 km », « 12,3 km »).
 */
export function formatDistanceFr(meters: number): string {
  const safe = Number.isFinite(meters) && meters > 0 ? meters : 0;
  const roundedMeters = Math.round(safe);
  if (roundedMeters < 1000) return `${roundedMeters} m`;
  const km = safe / 1000;
  const oneDecimal = Math.round(km * 10) / 10;
  const text = Number.isInteger(oneDecimal)
    ? String(oneDecimal)
    : oneDecimal.toFixed(1).replace(".", ",");
  return `${text} km`;
}

/** Feature Point GeoJSON d'un sommet de mesure (index = ordre de clic). */
interface MeasurePointFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: LngLatTuple };
  properties: { index: number };
}

/** GeoJSON de la source `measure-points` : un Point par sommet cliqué. */
export function buildMeasurePointsData(points: readonly LngLatTuple[]): {
  type: "FeatureCollection";
  features: MeasurePointFeature[];
} {
  return {
    type: "FeatureCollection",
    features: points.map((coordinates, index) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates },
      properties: { index },
    })),
  };
}

/**
 * GeoJSON de la source `measure-line` : la polyligne reliant les sommets.
 * Moins de 2 points ⇒ collection vide (pas de LineString dégénérée).
 */
export function buildMeasureLineData(points: readonly LngLatTuple[]): {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "LineString"; coordinates: LngLatTuple[] };
    properties: Record<string, never>;
  }>;
} {
  if (points.length < 2) {
    return { type: "FeatureCollection", features: [] };
  }
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [...points] },
        properties: {},
      },
    ],
  };
}
