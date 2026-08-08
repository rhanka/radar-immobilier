/**
 * geo-drill — logique PURE du drill géographique Province / Ville / Zone,
 * PARTAGÉE entre les vues carte (Signaux, Sources/Couverture).
 *
 * Niveau actif (commun aux deux vues) : « Lot » si un lot est sélectionné,
 * sinon « Zone » si une zone est sélectionnée, sinon « Ville » si une ville est
 * sélectionnée, sinon « Province ».
 *
 * L'état disabled/enabled des segments suit DEUX politiques (cf.
 * `buildDrillSegments`) : le contrat HISTORIQUE de la vue Sources (« Province »
 * et « Ville » toujours actifs, « Zone » grisé si zonage non configuré) et la
 * politique STRICTE de la vue Signaux (fil d'Ariane = indicateur : « Ville »
 * grisé sans ville, « Zone » grisé tant qu'aucune zone n'est active).
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
 * Segments du drill Province / Ville / Zone (+ Lot optionnel).
 *
 * DEUX politiques selon que `hasZoneSelection` est FOURNI :
 *
 *  - OMIS (vue Sources/Couverture) — contrat HISTORIQUE : « Province » et
 *    « Ville » toujours actifs ; « Zone » grisé seulement quand une ville est
 *    sélectionnée SANS zonage configuré (le fil d'Ariane sert à driller vers
 *    la 1re zone).
 *
 *  - FOURNI (vue Signaux) — politique STRICTE (fil d'Ariane = INDICATEUR de
 *    profondeur, pas un raccourci de saut) :
 *      · C1 — « Ville » grisé tant qu'aucune ville n'est sélectionnée ;
 *      · C2 — « Zone » grisé tant qu'aucune zone n'est effectivement active
 *        (fini le « saut vers une zone au hasard » : on entre dans une zone en
 *        cliquant son polygone sur la carte).
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
  /** Sélection de zone active. Sa PRÉSENCE bascule la politique stricte (C1/C2). */
  hasZoneSelection?: boolean;
}): DrillSegment[] {
  const strict = input.hasZoneSelection !== undefined;

  // ── « Ville » — C1 (strict) : grisé sans ville ; toujours actif sinon ──────
  const villeDisabled = strict && !input.hasSelectedCity;
  const ville: DrillSegment = strict
    ? {
        label: "Ville",
        disabled: villeDisabled,
        ariaLabel: villeDisabled ? "Ville (aucune ville sélectionnée)" : "Ville",
      }
    : { label: "Ville" };

  // ── « Zone » — C2 (strict) : grisé tant qu'aucune zone active ; historique
  //    sinon (grisé si ville sélectionnée sans zonage configuré). ─────────────
  const zoneDisabled = strict
    ? !input.hasZoneSelection
    : input.hasSelectedCity && !input.zonesConfigured;
  const zoneAriaLabel = strict
    ? !input.hasSelectedCity
      ? "Zone"
      : !input.zonesConfigured
        ? "Zone (zones non configurées)"
        : !input.hasZoneSelection
          ? "Zone (sélectionnez une zone sur la carte)"
          : "Zone"
    : zoneDisabled
      ? "Zone (zones non configurées)"
      : "Zone";

  const segments: DrillSegment[] = [
    { label: "Province" },
    ville,
    { label: "Zone", disabled: zoneDisabled, ariaLabel: zoneAriaLabel },
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
