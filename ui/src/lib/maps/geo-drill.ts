/**
 * geo-drill — logique PURE du drill géographique Province / Ville / Zone,
 * PARTAGÉE entre les vues carte (Signaux, Sources/Couverture).
 *
 * Contrat commun aux deux vues (parité d'interaction) :
 *  - segments : « Province » et « Ville » toujours actifs ; « Zone » grisé
 *    quand une ville est sélectionnée SANS zonage configuré (aria-label
 *    explicite), actif sinon ;
 *  - niveau actif : « Zone » si une zone est sélectionnée, sinon « Ville » si
 *    une ville est sélectionnée, sinon « Province ».
 *
 * Chaque vue garde sa POLITIQUE de sélection (bucket multi-sélection côté
 * Signaux, sélection simple côté Sources) et projette son état sur ces deux
 * fonctions — aucune logique carto/métier ici.
 */

/**
 * Entrée du segmented-control de drill. Structurellement identique à
 * `GeoSegment` (GeoCityMapBase) — défini ici pour garder ce module .ts pur
 * (pas d'import de composant .svelte dans un module de logique).
 */
export interface DrillSegment {
  label: string;
  disabled?: boolean;
  ariaLabel?: string;
}

export type DrillLevel = "Province" | "Ville" | "Zone";

/** Une réponse zones est « configurée » si elle porte au moins une vraie zone. */
export function zonesConfigured(
  zonesRes: {
    zoneCount: number;
    featureCollection: { features: unknown[] };
  } | null,
): boolean {
  return !!(
    zonesRes &&
    zonesRes.zoneCount > 0 &&
    zonesRes.featureCollection.features.length > 0
  );
}

/**
 * Segments du drill Province / Ville / Zone. « Zone » est grisé quand une
 * ville est sélectionnée mais que son zonage n'est pas configuré (l'état
 * Province laisse « Zone » actif : cliquer une ville reste le geste attendu).
 */
export function buildDrillSegments(input: {
  hasSelectedCity: boolean;
  zonesConfigured: boolean;
}): DrillSegment[] {
  const zoneDisabled = input.hasSelectedCity && !input.zonesConfigured;
  return [
    { label: "Province" },
    { label: "Ville" },
    {
      label: "Zone",
      disabled: zoneDisabled,
      ariaLabel: zoneDisabled ? "Zone (zones non configurées)" : "Zone",
    },
  ];
}

/** Niveau géo ACTIF du drill : Zone > Ville > Province. */
export function computeDrillLevel(input: {
  hasSelectedCity: boolean;
  hasZoneSelection: boolean;
}): DrillLevel {
  if (input.hasZoneSelection) return "Zone";
  return input.hasSelectedCity ? "Ville" : "Province";
}
