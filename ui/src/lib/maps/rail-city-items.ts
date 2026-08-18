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

/**
 * Filtre par recherche (nom OU sous-libellé, insensible à la casse).
 * Requête vide → items tels quels.
 *
 * AUCUN plafond d'affichage (P02) : la liste NON filtrée doit contenir TOUTE
 * ville que la recherche peut faire apparaître. Un plafond « top N » (60,
 * hérité de SignauxRail où la liste est pré-filtrée aux villes à signaux)
 * appliqué à la liste provinciale complète de la vue Couverture masquait
 * silencieusement toute ville au-delà du rang de coupe (ex. Saint-Stanislas,
 * priorityRank 477, non exclue/non dépriorisée) : invisible dans la liste,
 * pourtant trouvable par la recherche — incohérence recherche ↔ liste. Le
 * corps du rail est déjà scrollable (RailShell) et porte donc la liste
 * entière. Ce même plafond était aussi le mécanisme d'éjection de la ville
 * sélectionnée (#378) ; sans plafond, une ville n'est absente que si la
 * RECHERCHE l'écarte — un filtre explicite de l'utilisateur, jamais un
 * artefact de coupe/tri.
 */
export function filterRailCityItems(
  items: RailCityItem[],
  query: string,
): RailCityItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (item) =>
      item.name.toLowerCase().includes(q) ||
      (item.sublabel ?? "").toLowerCase().includes(q),
  );
}
