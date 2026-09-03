/**
 * entity-search — recherche PURE + classement des listes d'entités du panneau
 * droit (zones, lots), sœur de `filterRailCityItems` (rail villes gauche).
 *
 * Réutilisable pour toute liste : filtrage insensible à la casse ET aux
 * diacritiques + RANKING par pertinence (exact > préfixe > sous-chaîne du
 * libellé principal > sous-chaîne du sous-libellé), STABLE dans chaque palier
 * (préserve l'ordre d'entrée — qui porte déjà le tri métier). Requête vide →
 * liste INCHANGÉE (aucun reclassement, cap métier préservé).
 *
 * Anti-invention : ne fabrique aucun résultat ; une requête sans correspondance
 * renvoie [] (l'état vide « Aucun résultat » est rendu côté composant).
 */

export interface SearchableText {
  /** Libellé principal recherché (ex. code de zone « H-315 », n° de lot). */
  text: string;
  /** Sous-libellé optionnel (ex. libellé de zone, adresse du lot). */
  subtext?: string | null;
  /** Clé canonique de recherche calculée par l'appelant selon l'entité. */
  searchKey?: string | null;
}

/** Minuscule + suppression des diacritiques + trim (comparaison stable). */
export function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Palier de pertinence d'un candidat contre une requête DÉJÀ normalisée :
 *  0 = égalité exacte du libellé ; 1 = préfixe ; 2 = autre sous-chaîne du
 *  libellé ; 3 = correspondance seulement dans le sous-libellé ; -1 = aucune.
 * `qNorm` est supposée non vide (le cas requête vide est traité en amont).
 */
export function matchRank(
  text: string,
  subtext: string | null | undefined,
  qNorm: string,
): number {
  const t = normalizeSearch(text);
  if (t === qNorm) return 0;
  if (t.startsWith(qNorm)) return 1;
  if (t.includes(qNorm)) return 2;
  const s = subtext ? normalizeSearch(subtext) : "";
  if (s.length > 0 && s.includes(qNorm)) return 3;
  return -1;
}

/** Rang exact/préfixe d'une clé canonique ; aucune sous-chaîne ni fuzzy. */
export function canonicalRank(
  itemKey: string | null | undefined,
  queryKey: string | undefined,
): number {
  if (!itemKey || !queryKey) return -1;
  if (itemKey === queryKey) return 0;
  if (itemKey.startsWith(queryKey)) return 1;
  return -1;
}

/**
 * Filtre + classe `items` par `query` via `accessor`. Requête vide/espaces →
 * `items` renvoyé tel quel. Sinon : ne garde que les correspondances, triées
 * par palier de pertinence puis par ordre d'entrée (tri stable).
 */
export function rankBySearch<T>(
  items: readonly T[],
  query: string,
  accessor: (item: T) => SearchableText,
  queryKey?: string,
): T[] {
  const qNorm = normalizeSearch(query);
  if (qNorm.length === 0) return items.slice();
  const ranked: Array<{ item: T; rank: number; index: number }> = [];
  items.forEach((item, index) => {
    const { text, subtext, searchKey } = accessor(item);
    const textRank = matchRank(text, subtext, qNorm);
    const keyRank = canonicalRank(searchKey, queryKey);
    const rank = textRank < 0 ? keyRank : keyRank < 0 ? textRank : Math.min(textRank, keyRank);
    if (rank >= 0) ranked.push({ item, rank, index });
  });
  ranked.sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.index - b.index));
  return ranked.map((r) => r.item);
}

/**
 * Prochain index actif de la navigation clavier (↑/↓) dans une liste de
 * `length` résultats. -1 = aucun actif. Depuis -1 : ↓ (`delta > 0`) va au
 * premier, ↑ (`delta < 0`) au dernier ; ensuite l'index défile EN BOUCLE. Une
 * liste vide reste toujours à -1.
 */
export function nextActiveIndex(
  current: number,
  delta: number,
  length: number,
): number {
  if (length <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : length - 1;
  return (current + delta + length) % length;
}
