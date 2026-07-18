/**
 * zone-millesime-filter — filtre par MILLÉSIME de règlement de zonage.
 *
 * Miroir de `zone-kind-filter`, mais sémantique EXCLUSIVE : un seul millésime à
 * la fois (≠ le filtre TYPE, additif). Le millésime porté PAR ZONE
 * (`reglementMillesime`, ex. "2008") vient de la donnée servie par geo.
 *
 * Dégradé HONNÊTE (contrat produit) :
 *  - le sélecteur n'existe que si AU MOINS 2 millésimes distincts sont servis
 *    pour la ville (`hasMultipleZoneMillesimes`) — JAMAIS un sélecteur
 *    mono-option. Aujourd'hui une seule cohorte par ville (ex. Mont-Tremblant =
 *    tout 2008 / 2008-102) : l'axe existe mais reste latent tant que geo ne sert
 *    pas plusieurs cohortes (ask geo en cours, cf. note PR) ;
 *  - défaut = « tous » (`null`) : aucune zone n'est retirée ;
 *  - ZÉRO refetch : un changement ne fait que recalculer la peinture MapLibre
 *    (millésime sélectionné accentué, hors-millésime estompé mais visible).
 */

/**
 * Filtre MILLÉSIME : le millésime retenu (ex. "2008"), ou `null` = tous.
 * Exclusif — au plus une valeur à la fois.
 */
export type ZoneMillesimeFilter = string | null;

export const DEFAULT_ZONE_MILLESIME_FILTER: ZoneMillesimeFilter = null;

export function isDefaultZoneMillesimeFilter(
  filter: ZoneMillesimeFilter,
): boolean {
  return filter === null;
}

/** Une valeur de millésime présente + son compte de zones. */
export interface ZoneMillesimeValue {
  millesime: string;
  count: number;
}

/**
 * Millésimes RÉELLEMENT présents dans les zones fournies, triés du plus récent
 * au plus ancien (comparaison numérique), avec le nombre de zones par millésime.
 * Les zones sans millésime servi sont ignorées (aucune invention). Contrat
 * miroir de `zoneKindGroupCounts` : on ne propose pas de valeur sans zone.
 */
export function zoneMillesimeValues(
  zones: ReadonlyArray<{ reglementMillesime?: string | null }>,
): ZoneMillesimeValue[] {
  const counts = new Map<string, number>();
  for (const zone of zones) {
    const millesime = (zone.reglementMillesime ?? "").trim();
    if (millesime.length === 0) continue;
    counts.set(millesime, (counts.get(millesime) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([millesime, count]) => ({ millesime, count }))
    .sort((a, b) =>
      b.millesime.localeCompare(a.millesime, "fr-CA", { numeric: true }),
    );
}

/**
 * true quand ≥ 2 millésimes distincts sont servis — SEUL cas où le sélecteur
 * doit apparaître (dégradé honnête, jamais mono-option).
 */
export function hasMultipleZoneMillesimes(
  zones: ReadonlyArray<{ reglementMillesime?: string | null }>,
): boolean {
  return zoneMillesimeValues(zones).length >= 2;
}

/**
 * true si la zone matche le filtre (filtre `null` = tout matche). Exclusif :
 * une zone matche seulement si SON millésime égale le millésime retenu.
 */
export function zoneMatchesMillesime(
  reglementMillesime: string | null | undefined,
  filter: ZoneMillesimeFilter,
): boolean {
  if (filter === null) return true;
  return (reglementMillesime ?? "").trim() === filter;
}

/** Compte les zones matchées (compteur « N / M » quand un millésime est retenu). */
export function countZoneMillesimeMatches(
  zones: ReadonlyArray<{ reglementMillesime?: string | null }>,
  filter: ZoneMillesimeFilter,
): number {
  let count = 0;
  for (const zone of zones) {
    if (zoneMatchesMillesime(zone.reglementMillesime ?? null, filter)) count += 1;
  }
  return count;
}

// ── Peinture pilotée par le filtre MILLÉSIME ────────────────────────────────
// Même mécanique que le filtre TYPE (zone-kind-filter) : millésime retenu
// accentué, hors-millésime estompé (JAMAIS masqué), zéro refetch.

/** Zone hors-millésime : estompée mais toujours visible (parité kind). */
export const ZONE_MILLESIME_FILTER_DIMMED_OPACITY = 0.06;
/** Zone au millésime retenu : teinte accentuée. */
export const ZONE_MILLESIME_FILTER_MATCH_OPACITY = 0.45;

/**
 * Opacité pilotée par le filtre MILLÉSIME — `null` quand le filtre est inactif
 * (la hiérarchie d'opacité existante s'applique alors sans changement).
 */
export function zoneMillesimeFilterOpacity(
  reglementMillesime: string | null | undefined,
  filter: ZoneMillesimeFilter,
): number | null {
  if (filter === null) return null;
  return zoneMatchesMillesime(reglementMillesime, filter)
    ? ZONE_MILLESIME_FILTER_MATCH_OPACITY
    : ZONE_MILLESIME_FILTER_DIMMED_OPACITY;
}
