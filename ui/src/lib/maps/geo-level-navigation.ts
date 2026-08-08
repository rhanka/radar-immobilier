/**
 * Logique PURE de transition de niveau géo (Province / Ville / Zone) du
 * segmented-control de la vue Signaux.
 *
 * Extraite de SignauxMapView.handleGeoLevelClick pour être testable sans
 * MapLibre/WebGL (indisponible en CI headless). Décide UNIQUEMENT la cible de
 * navigation d'URL à produire ; les effets de bord (clearSelection, MapLibre)
 * restent dans le composant.
 *
 * Bug #4 — DÉZOOM : depuis un focus ville, le retour « Province » doit remettre
 * l'URL au niveau `region` (avec le filtre subset préservé). Sans cela l'URL
 * restait sur `city:slug` et, au reload/navigation, le focus ville était
 * réappliqué → on restait « coincé » en focus ville.
 */

import type { GeoMode, GeoRouteTarget } from "$lib/router/geo-route.js";

/** Normalise un mode arbitraire (string) vers le type fermé GeoMode. */
function toGeoMode(mode: string | undefined): GeoMode {
  return mode === "data" ? "data" : "signal";
}

export type GeoLevel = "Province" | "Ville" | "Zone";

/**
 * Résolution du clic GÉOGRAPHIQUE sur un polygone LOT selon le niveau de drill
 * (règle 1 owner — nav-drill 01KZEG78). Hiérarchie stricte Ville → Zone → Lot :
 *  - VUE VILLE (aucune zone entrée) : un clic sur un LOT n'est PAS une sélection
 *    de lot ; il RÉSOUT vers sa ZONE contenante (entrée en vue zone) → 1er clic
 *    du drill géographique. Sans zone dérivable → aucune action (jamais une
 *    sélection lot hors vue zone, jamais un clic mort qui « saute au lot »).
 *  - VUE ZONE (zone entrée) : le lot devient sélectionnable → sélection lot.
 * Corrige le bug carte : le clic géographique lot ne doit PAS aller direct au
 * lot en vue ville (la garde LISTE/bucket seule ne couvrait pas la carte).
 */
export type GeoLotClickResolution =
  | { kind: "select-lot" }
  | { kind: "enter-zone"; code: string }
  | { kind: "ignore" };

export function resolveGeoLotClick(input: {
  /** Une zone est-elle déjà entrée (vue zone) ? */
  hasZoneSelection: boolean;
  /** Zone contenante du lot cliqué (servie par geo : `zoneCode`), si connue. */
  zoneCode: string | null;
}): GeoLotClickResolution {
  if (input.hasZoneSelection) return { kind: "select-lot" };
  if (input.zoneCode) return { kind: "enter-zone", code: input.zoneCode };
  return { kind: "ignore" };
}

export interface GeoLevelNavInput {
  /** Niveau cible cliqué dans le segmented-control. */
  target: GeoLevel;
  /** Niveau actif courant (dérivé de l'état du composant). */
  current: GeoLevel;
  /** Une ville est-elle sélectionnée ? */
  hasSelectedCity: boolean;
  /** Mode de carte courant (route.state.mode), défaut "signal". */
  mode?: string;
  /** Clé de filtre subset active, ex. "z|m|p" (préservée dans la route). */
  subsetKey?: string;
}

/**
 * Retourne la navigation d'URL à effectuer pour ce changement de niveau, ou
 * `null` si aucune navigation n'est requise (no-op).
 */
export function buildGeoLevelNavigation(
  input: GeoLevelNavInput,
): GeoRouteTarget | null {
  const { target, current, hasSelectedCity } = input;
  // Clic sur le niveau déjà actif → aucune transition.
  if (target === current) return null;

  if (target === "Province") {
    // Dézoom vers province : on persiste le retour au niveau région dans l'URL,
    // en conservant le filtre subset actif.
    return {
      level: "region",
      state: buildState(input),
    };
  }

  if (target === "Ville") {
    // Revenir au niveau ville n'a de sens que si une ville est sélectionnée.
    // L'URL ville est déjà posée par selectCity → pas de re-navigation ici.
    return null;
  }

  // target === "Zone" : la sélection de zone (et sa navigation) est pilotée par
  // la première zone disponible côté composant (besoin des données zones).
  if (!hasSelectedCity) return null;
  return null;
}

function buildState(input: GeoLevelNavInput): {
  mode: GeoMode;
  filters?: Record<string, string[]>;
} {
  const mode = toGeoMode(input.mode);
  const subsetValues = input.subsetKey ? input.subsetKey.split("|") : [];
  return subsetValues.length > 0
    ? { mode, filters: { subset: subsetValues } }
    : { mode };
}
