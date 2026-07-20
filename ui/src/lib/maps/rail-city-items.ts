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
 *
 * `keepSlug` (ville SÉLECTIONNÉE) est EXEMPTÉE du plafond : la coupe au
 * plafond était le mécanisme d'éjection du bug #378 (ville sélectionnée triée
 * en bas → coupée du rail). Elle reste soumise à la RECHERCHE : une requête
 * qui l'écarte est un filtre explicite de l'utilisateur, pas un artefact de
 * tri/fetch.
 */
export function filterRailCityItems(
  items: RailCityItem[],
  query: string,
  max = RAIL_CITY_LIST_MAX,
  keepSlug: string | null = null,
): RailCityItem[] {
  const q = query.trim().toLowerCase();
  const matched = q
    ? items.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          (item.sublabel ?? "").toLowerCase().includes(q),
      )
    : items;
  const capped = matched.slice(0, max);
  if (keepSlug !== null && !capped.some((item) => item.slug === keepSlug)) {
    const kept = matched.find((item) => item.slug === keepSlug);
    if (kept) capped.push(kept);
  }
  return capped;
}
