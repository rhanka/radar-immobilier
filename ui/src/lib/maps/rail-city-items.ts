/**
 * rail-city-items — modèle PUR de la liste plate de villes des rails gauches
 * (RailCityList, partagé Signaux ↔ Sources).
 *
 * Chaque vue projette ses données (CityMapEntry côté Signaux, CityCoverage
 * côté Sources) vers des `RailCityItem` génériques ; la recherche et le
 * plafonnement d'affichage sont mutualisés ici.
 */

export type RailCityBadgeTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "error";

export interface RailCityBadge {
  label: string;
  tone: RailCityBadgeTone;
  /** `aria-label` optionnel du badge (ex. « 7 signaux »). */
  ariaLabel?: string;
}

export interface RailCityItem {
  slug: string;
  name: string;
  /** Sous-libellé (MRC…) — null si inconnu. */
  sublabel: string | null;
  /**
   * Pastille de statut : soit un tone DS (classe — rampe signaux), soit une
   * couleur RÉSOLUE (style inline — tri-état couverture). `dotColor` prime.
   */
  dotTone?: "neutral" | "warning" | "error";
  dotColor?: string;
  badge: RailCityBadge;
}

/** Plafond d'affichage de la liste (parité SignauxRail historique). */
export const RAIL_CITY_LIST_MAX = 60;

/**
 * Filtre par recherche (nom OU sous-libellé, insensible à la casse) puis
 * plafonne à `max` lignes. Requête vide → items tels quels (plafonnés).
 */
export function filterRailCityItems(
  items: RailCityItem[],
  query: string,
  max = RAIL_CITY_LIST_MAX,
): RailCityItem[] {
  const q = query.trim().toLowerCase();
  const matched = q
    ? items.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          (item.sublabel ?? "").toLowerCase().includes(q),
      )
    : items;
  return matched.slice(0, max);
}
