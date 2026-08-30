/**
 * Normalisation géo canonique — codes de zone & numéros de lot cadastraux (QC).
 *
 * Impl UNIQUE partagée api + ui : le front et le back convergent sur la même
 * normalisation déterministe, pour que les matches ne divergent jamais.
 *
 * Deux couches distinctes (identité ≠ recherche) :
 * - IDENTITÉ (`normalizeZoneCode`, `normalizeLotKey`) : join / stockage / clé.
 *   Ne fusionne JAMAIS deux entités distinctes (H-431 ≠ H431 ; H-10-1 ≠ H-101).
 * - RECHERCHE (`zoneSearchKey`) : tolérance de saisie, dérivée de la canonique.
 *   Peut sur-matcher (many-to-one) ; l'appelant retourne l'ensemble des
 *   candidats en affichage verbatim, jamais un match fusionné.
 */

/**
 * Code de zone CANONIQUE (identité / join lot↔zone / stockage / affichage).
 * Préserve les tirets — ils portent du sens (H-431 ≠ H431 ; H-10-1 ≠ H-101).
 * - Majuscules
 * - Tirets demi-cadratins (–, —) → tiret ASCII (-)
 * - Suffixe secteur parenthésé : parenthèses ÉQUILIBRÉES retirées mais CONTENU
 *   conservé (`(AGF)` → `AGF`) — le suffixe distingue des zones réelles (mesuré
 *   geo-zones 29a14334 : `02 (AGF)` ≠ `02 (RCT)`) ; ne PAS blanket-stripper.
 * - Suppression de tous les espaces restants
 *
 * Exemples :
 *   "H34-327 (VLO)"  -> "H34-327VLO"
 *   "h-431"          -> "H-431"
 *   "H–431"          -> "H-431"   (demi-cadratin unicode)
 *   "H 34-327"       -> "H34-327"
 *   null / undefined -> ""
 *
 * @param raw - Valeur brute (string ou unknown : propriétés OGC, DB, JSON, saisie).
 */
export function normalizeZoneCode(raw: unknown): string {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[–—]/g, "-")
    // Suffixe secteur parenthésé : GARDER le contenu alnum (distingueur mesuré —
    // geo-zones record 29a14334 : `02 (AGF)` ≠ `02 (RCT)`), retirer seulement les
    // parenthèses ÉQUILIBRÉES. Un blanket-strip `\(…\)` était NON injectif (16
    // fusions fausses). L'équilibré préserve le malformé `01 AGF)` ≠ `01 (AGF)`.
    .replace(/\(([A-Z0-9]{2,8})\)/g, "$1")
    .replace(/\s+/g, "");
}

/**
 * Clé de RECHERCHE de zone — dérivée de la canonique, séparateurs strippés.
 * Tolérance de saisie utilisateur : "H101" ≡ "H-101" (exigence owner).
 *
 * NE PAS stocker ni utiliser comme identité : c'est une clé de MATCHING.
 * Elle est many-to-one (ex. "H-101" et "H-10-1" partagent "H101"). L'appelant
 * DOIT retourner l'ensemble des `raw` distincts qui partagent la clé (candidats
 * verbatim), jamais les fusionner — l'identité (`normalizeZoneCode`) les garde
 * distincts, donc le sur-match reste une désambiguïsation UX sûre.
 *
 * Exemples :
 *   "H-101"          -> "H101"
 *   "H101"           -> "H101"   (≡ ci-dessus)
 *   "h-101 (VLO)"    -> "H101"
 *   null / undefined -> ""
 */
export function zoneSearchKey(raw: unknown): string {
  return normalizeZoneCode(raw).replace(/[^A-Z0-9]/g, "");
}

/**
 * Clé de numéro de lot cadastral — digits-only (join `no_lot_norm` + recherche).
 * Deux lots distincts = deux séquences de digits distinctes (aucun faux-merge,
 * pas de risque multi-segment). L'affichage reste verbatim (hors de cette fn).
 *
 * Exemples :
 *   "6 057 912"      -> "6057912"
 *   "6057912"        -> "6057912"
 *   "6.057.912"      -> "6057912"
 *   null / undefined -> ""
 *
 * @param raw - Valeur brute (string ou unknown : DB, JSON, saisie).
 */
export function normalizeLotKey(raw: unknown): string {
  return String(raw ?? "").replace(/[^0-9]/g, "");
}
