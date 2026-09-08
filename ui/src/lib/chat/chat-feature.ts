/**
 * Feature-flag du CHAT carte — DÉSACTIVÉ PAR DÉFAUT (décision owner 2026-09-07,
 * `DECISION_CHAT_DISABLE_STACK_LLMMESH_2026-09-07.md`).
 *
 * Le chat (Lot 2, store #564) est validé visuellement mais requiert une refonte
 * avant ré-activation : (a) stacking DANS le pane droit + (b) backend llm-mesh.
 * En attendant, on le DÉSACTIVE — sans rien retirer du code Lot 2 : le déclencheur
 * (rangée de contrôles carte) et le widget (`ChatWidgetHost`) sont simplement
 * GATÉS par ce flag → RÉVERSIBLE (flag ON ré-active tout, à l'identique).
 *
 * Mécanisme : suit le PRÉCÉDENT VITE du repo (cf. `VITE_GEO_SAT_BASEMAP`,
 * `geo-sat-basemap.ts`). Flag build-time `VITE_CHAT_ENABLED`. ON UNIQUEMENT quand
 * la valeur vaut EXACTEMENT `"true"` ; absent / toute autre valeur ⇒ OFF (défaut).
 * Coeur PUR (`chatFeatureFlagOn`) testable sans env ; `isChatEnabled()` lit le flag
 * au seam (même découpe pur/seam que `isSatelliteBasemapEnabled`).
 */

/**
 * Coeur PUR : le flag chat est-il activé pour cette valeur brute ? Seul `"true"`
 * active (défaut OFF). `undefined`/`null`/`""`/toute autre valeur ⇒ `false`.
 */
export function chatFeatureFlagOn(
  rawFlag: string | undefined | null,
): boolean {
  return rawFlag === "true";
}

/**
 * Le chat carte est-il activé ? Défaut OFF ; ON ssi `VITE_CHAT_ENABLED === "true"`.
 * Lecture du flag au seam (build-time VITE), délègue au coeur pur ci-dessus.
 */
export function isChatEnabled(): boolean {
  return chatFeatureFlagOn(import.meta.env.VITE_CHAT_ENABLED);
}
