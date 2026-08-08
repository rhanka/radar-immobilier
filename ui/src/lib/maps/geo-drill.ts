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

export type DrillLevel = "Province" | "Ville" | "Zone" | "Lot";

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
 * Segments du drill Province / Ville / Zone (+ Lot optionnel). « Zone » est
 * grisé quand une ville est sélectionnée mais que son zonage n'est pas
 * configuré (l'état Province laisse « Zone » actif : cliquer une ville reste
 * le geste attendu).
 *
 * `includeLotLevel` ajoute un 4e segment « Lot » (drill Ville → Zone → Lot de
 * la vue Signaux ; la vue Sources n'en veut pas, d'où l'option). Le segment
 * « Lot » est grisé tant qu'aucun lot n'est sélectionné : on n'y entre qu'en
 * cliquant un lot (carte/liste), jamais en cliquant le segment lui-même —
 * miroir de « Zone » qui n'existe qu'une fois une ville en scène.
 */
export function buildDrillSegments(input: {
  hasSelectedCity: boolean;
  zonesConfigured: boolean;
  includeLotLevel?: boolean;
  hasLotSelection?: boolean;
}): DrillSegment[] {
  const zoneDisabled = input.hasSelectedCity && !input.zonesConfigured;
  const segments: DrillSegment[] = [
    { label: "Province" },
    { label: "Ville" },
    {
      label: "Zone",
      disabled: zoneDisabled,
      ariaLabel: zoneDisabled ? "Zone (zones non configurées)" : "Zone",
    },
  ];
  if (input.includeLotLevel) {
    const lotDisabled = !input.hasLotSelection;
    segments.push({
      label: "Lot",
      disabled: lotDisabled,
      ariaLabel: lotDisabled ? "Lot (sélectionnez un lot sur la carte)" : "Lot",
    });
  }
  return segments;
}

/** Niveau géo ACTIF du drill : Lot > Zone > Ville > Province. */
export function computeDrillLevel(input: {
  hasSelectedCity: boolean;
  hasZoneSelection: boolean;
  hasLotSelection?: boolean;
}): DrillLevel {
  if (input.hasLotSelection) return "Lot";
  if (input.hasZoneSelection) return "Zone";
  return input.hasSelectedCity ? "Ville" : "Province";
}
