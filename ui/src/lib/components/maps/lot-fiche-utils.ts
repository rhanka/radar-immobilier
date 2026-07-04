/**
 * Utilitaires purs pour LotFichePanel — CS-L2.
 *
 * Fonctions extraites du composant pour pouvoir être testées unitairement
 * sans JSDOM/Svelte.
 *
 * Anti-PII (Loi 25) : ces fonctions n'opèrent que sur des données publiques
 * (noLot, géométrie, score). Aucun nom de propriétaire ni PII n'est traité.
 */

import type { LotFeature, LotProperties } from "$lib/maps/lots-client.js";

// ── Centroïde ──────────────────────────────────────────────────────────────────

/**
 * Calcule le centroïde approché d'un polygone GeoJSON (anneau extérieur).
 * Utilisé pour générer le lien Google Maps.
 * Retourne null si la géométrie est absente ou invalide.
 */
export function centroid(
  feature: LotFeature,
): { lat: number; lon: number } | null {
  const geom = feature.geometry;
  if (!geom || geom.type !== "Polygon") return null;
  const ring = (geom.coordinates as number[][][])[0];
  if (!ring || ring.length === 0) return null;
  const sumLon = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const sumLat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return { lat: sumLat, lon: sumLon };
}

// ── Google Maps URL ────────────────────────────────────────────────────────────

/**
 * Construit le lien Google Maps depuis lat/lon.
 * Format : https://www.google.com/maps?q=lat,lon
 */
export function googleMapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps?q=${lat.toFixed(6)},${lon.toFixed(6)}`;
}

/**
 * Construit un lien Google Street View public depuis lat/lon.
 * Le service Google choisit le panorama disponible le plus proche.
 */
export function googleStreetViewUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lon.toFixed(6)}`;
}

// ── Façade estimée ─────────────────────────────────────────────────────────────

/**
 * Façade estimée du lot en mètres, calculée depuis la géométrie publique.
 *
 * ## Méthode (documentée — estimation géométrique, pas une mesure d'arpenteur)
 * 1. L'anneau extérieur du polygone est projeté en mètres par approximation
 *    équirectangulaire locale (1° lat ≈ 111 320 m ; 1° lon ≈ 111 320 × cos(lat)).
 *    Erreur négligeable à l'échelle d'un lot (< 0,1 %).
 * 2. Enveloppe convexe (chaîne monotone d'Andrew).
 * 3. Rectangle englobant ORIENTÉ minimal (rotating calipers : pour chaque arête
 *    de l'enveloppe, on mesure le rectangle aligné sur cette arête et on garde
 *    celui d'aire minimale).
 * 4. La façade = le PETIT côté de ce rectangle : un lot résidentiel typique
 *    présente sa face étroite sur rue.
 *
 * Fiabilité : bonne pour les lots quadrilatéraux réguliers (l'immense
 * majorité) ; indicative pour les formes en L ou en drapeau. Quand la source
 * expose une façade MESURÉE (`facadeM`), celle-ci doit être préférée.
 *
 * Retourne null si la géométrie est absente, dégénérée (< 3 points distincts)
 * ou d'aire nulle — aucune invention.
 */
export function estimatedFacadeM(feature: LotFeature): number | null {
  const geom = feature.geometry;
  if (!geom || geom.type !== "Polygon") return null;
  const ring = (geom.coordinates as number[][][])[0];
  if (!ring || ring.length < 3) return null;

  // 1. Projection locale en mètres.
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const pts: Array<[number, number]> = ring.map((p) => [
    p[0] * mPerDegLon,
    p[1] * mPerDegLat,
  ]);

  // 2. Enveloppe convexe.
  const hull = convexHull(pts);
  if (hull.length < 3) return null;

  // 3. Rectangle orienté minimal (rotating calipers sur les arêtes du hull).
  let best: { area: number; w: number; h: number } | null = null;
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i];
    const [x2, y2] = hull[(i + 1) % hull.length];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const ux = dx / len;
    const uy = dy / len;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, y] of hull) {
      const u = x * ux + y * uy;
      const v = -x * uy + y * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const w = maxU - minU;
    const h = maxV - minV;
    const area = w * h;
    if (best === null || area < best.area) best = { area, w, h };
  }
  if (!best || best.area <= 0) return null;

  // 4. Façade = petit côté du rectangle minimal.
  const facade = Math.min(best.w, best.h);
  return Math.round(facade * 10) / 10;
}

/** Enveloppe convexe (chaîne monotone d'Andrew), points (x,y) en mètres. */
function convexHull(points: Array<[number, number]>): Array<[number, number]> {
  const unique = Array.from(
    new Map(points.map((p) => [`${p[0]},${p[1]}`, p])).values(),
  ).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (unique.length < 3) return unique;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Array<[number, number]> = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// ── Score de potentiel ─────────────────────────────────────────────────────────

/**
 * Retourne la tone Badge selon le score de potentiel (0–10).
 * Échelle : ≥7 = élevé (success), ≥4 = moyen (warning), ≥1 = faible (info),
 * 0 ou undefined = nul (neutral).
 */
export function scoreTone(
  score: number | null | undefined,
): "success" | "warning" | "error" | "neutral" | "info" {
  if (score === undefined || score === null) return "neutral";
  if (score >= 7) return "success";
  if (score >= 4) return "warning";
  if (score >= 1) return "info";
  return "neutral";
}

/**
 * Retourne le label textuel du score de potentiel.
 */
export function scoreLabel(score: number | null | undefined): string {
  if (score === undefined || score === null) return "non calculé";
  if (score >= 7) return "Élevé";
  if (score >= 4) return "Moyen";
  if (score >= 1) return "Faible";
  return "Nul";
}

/**
 * Score de potentiel réellement ÉVALUÉ d'un lot, ou null quand il ne l'est pas.
 *
 * `lots-client` renvoie toujours un `potentialScore` numérique (0 par défaut),
 * accompagné d'un `potentialScoreStatus` : "scored" (fourni par la source),
 * "fallback" (dérivé d'indicateurs zone/flags) ou "unavailable" (aucune donnée).
 * Retourne null — l'UI affiche « non évalué », jamais « 0.0/10 » — quand :
 *   - status "unavailable" (le 0 est un placeholder, pas une mesure) ;
 *   - status "fallback" avec score 0 : la dérivation n'a trouvé AUCUNE évidence
 *     positive (zone sans densité ni type porteur) — ce 0 n'est pas une mesure.
 * Un score numérique legacy sans statut est conservé (compat sources
 * historiques), de même qu'un vrai 0 MESURÉ ("scored").
 */
export function evaluatedLotScore(
  props: Pick<LotProperties, "potentialScore" | "potentialScoreStatus">,
): number | null {
  const score = props.potentialScore;
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  if (props.potentialScoreStatus === "unavailable") return null;
  if (props.potentialScoreStatus === "fallback" && score <= 0) return null;
  return score;
}

// ── Champs enrichis de la fiche/carte lot ──────────────────────────────────────

/**
 * Code de zone affichable d'un lot : `zoneCode` plat (collection OGC / join
 * #314) sinon le code porté par l'objet `zone` joint. null si la source
 * n'expose aucun code — aucune invention.
 */
export function lotZoneCode(
  props: Pick<LotProperties, "zoneCode" | "zone">,
): string | null {
  return props.zoneCode ?? props.zone?.code ?? null;
}

// ── Formatage partagé (LotFichePanel + carte lot du panneau Signaux) ───────────

/** Superficie en m² arrondie, locale fr-CA ; « — » discret quand absente. */
export function formatArea(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value).toLocaleString("fr-CA")} m²`;
}

/** Booléen client-facing : « Oui » / « Non » ; « — » discret quand absent. */
export function formatYesNo(value: boolean | null | undefined): string {
  if (value === undefined || value === null) return "—";
  return value ? "Oui" : "Non";
}

/**
 * Façade affichable d'un lot (C5) : la façade SERVIE prime — `facadeM` porte
 * la valeur canonique geo (`frontage_m`) ou à défaut la mesure de la source
 * (`facade_m`), cf. mapping lots-client — affichée sans mention « estimée » ;
 * sinon l'ESTIMATION géométrique (`estimatedFacadeM`), affichée honnêtement
 * comme telle (« ≈ … m (estimée) ») ; « — » discret quand ni l'une ni l'autre.
 */
export function facadeDisplay(feature: LotFeature): string {
  const measured = feature.properties.facadeM;
  if (typeof measured === "number" && Number.isFinite(measured) && measured > 0) {
    return `${formatMeters(measured)} m`;
  }
  const estimated = estimatedFacadeM(feature);
  if (estimated !== null && estimated > 0) {
    return `≈ ${formatMeters(estimated)} m (estimée)`;
  }
  return "—";
}

/** Longueur en mètres, 1 décimale max, locale fr-CA. */
function formatMeters(value: number): string {
  return (Math.round(value * 10) / 10).toLocaleString("fr-CA", {
    maximumFractionDigits: 1,
  });
}

/** Longueur affichable : « X m » (1 décimale, fr-CA) ; « — » discret quand absente. */
export function formatLength(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${formatMeters(value)} m`;
}
