/**
 * Utilitaires purs pour LotFichePanel — CS-L2.
 *
 * Fonctions extraites du composant pour pouvoir être testées unitairement
 * sans JSDOM/Svelte.
 *
 * Anti-PII (Loi 25) : ces fonctions n'opèrent que sur des données publiques
 * (noLot, géométrie, score). Aucun nom de propriétaire ni PII n'est traité.
 */

import type { LotFeature } from "$lib/maps/lots-client.js";

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

// ── Score de potentiel ─────────────────────────────────────────────────────────

/**
 * Retourne la tone Badge selon le score de potentiel (0–10).
 * Échelle : ≥7 = élevé (success), ≥4 = moyen (warning), ≥1 = faible (info),
 * 0 ou undefined = nul (neutral).
 */
export function scoreTone(
  score: number | undefined,
): "success" | "warning" | "error" | "neutral" | "info" {
  if (score === undefined) return "neutral";
  if (score >= 7) return "success";
  if (score >= 4) return "warning";
  if (score >= 1) return "info";
  return "neutral";
}

/**
 * Retourne le label textuel du score de potentiel.
 */
export function scoreLabel(score: number | undefined): string {
  if (score === undefined) return "non calculé";
  if (score >= 7) return "Élevé";
  if (score >= 4) return "Moyen";
  if (score >= 1) return "Faible";
  return "Nul";
}
