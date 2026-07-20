/**
 * m5 / UAT round2 — Résolution de la préférence d'affichage des libellés carte
 * (n° de zone vs n° de lot) de la vue Signaux.
 *
 * UNE SEULE bascule EXCLUSIVE : à l'ouverture d'une ville, le n° de ZONE est
 * affiché PAR DÉFAUT ; le n° de LOT est une bascule explicite (retour PO ferme).
 *
 * Migration du legacy-state (round-1 « deux cases ») : l'ancienne UI persistait
 * DEUX clés indépendantes (`signaux-show-zone-labels` / `signaux-show-lot-labels`,
 * valeurs "0"/"1", défaut MASQUÉ). Ces clés ne sont PLUS JAMAIS relues : une
 * valeur legacy « false » (= masqué) ne peut donc pas réimposer un état masqué
 * ni forcer le mode lot au premier chargement. Seule la clé namespacée du
 * round-2 fait autorité ; en son absence, le défaut est ZONE.
 */

export type LegendLabelMode = "zone" | "lot";

/** Clé autoritaire (round-2) : "zone" | "lot". Absente ⇒ défaut ZONE. */
export const LEGEND_LABEL_MODE_LS_KEY = "signaux-legend-label-mode";

/** Clés de l'ère « deux cases » (round-1) — désormais purgées, jamais relues. */
export const LEGACY_ZONE_LABELS_LS_KEY = "signaux-show-zone-labels";
export const LEGACY_LOT_LABELS_LS_KEY = "signaux-show-lot-labels";

type ReadableStorage = Pick<Storage, "getItem">;
type PrunableStorage = Pick<Storage, "removeItem">;
type PersistableStorage = Pick<Storage, "setItem">;

/**
 * Mode de libellé effectif au chargement.
 * Priorité : clé round-2 explicite ("lot" ou "zone") > défaut ZONE.
 * Les clés legacy ne sont PAS consultées : un ancien "false" ne réimpose rien.
 */
export function resolveLegendLabelMode(
  storage: ReadableStorage | null | undefined,
): LegendLabelMode {
  if (!storage) return "zone";
  return storage.getItem(LEGEND_LABEL_MODE_LS_KEY) === "lot" ? "lot" : "zone";
}

/**
 * Nettoyage cosmétique du legacy-state : supprime les deux clés de l'ère
 * « deux cases » pour ne pas laisser traîner d'état périmé. No-op si absentes.
 * N'a AUCUN effet sur le mode résolu (elles ne sont déjà plus lues) : c'est
 * une purge de propreté, sûre à appeler à chaque montage.
 */
export function migrateLegacyLegendLabelKeys(
  storage: PrunableStorage | null | undefined,
): void {
  if (!storage) return;
  storage.removeItem(LEGACY_ZONE_LABELS_LS_KEY);
  storage.removeItem(LEGACY_LOT_LABELS_LS_KEY);
}

/** Persiste le choix explicite (session) sous la clé autoritaire round-2. */
export function persistLegendLabelMode(
  storage: PersistableStorage | null | undefined,
  mode: LegendLabelMode,
): void {
  storage?.setItem(LEGEND_LABEL_MODE_LS_KEY, mode);
}
