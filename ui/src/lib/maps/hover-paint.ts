/**
 * hover-paint — expressions MapLibre de SURVOL des aplats zone/lot (C6).
 *
 * Le socle GeoCityMapBase pose l'état `feature-state.hover` sur la feature
 * survolée (mousemove/mouseleave). Ces helpers ENVELOPPENT les expressions de
 * peinture calculées par la vue pour réagir à cet état :
 *  - opacité : l'élément survolé devient MOINS transparent (teinte accentuée),
 *    sans jamais descendre sous son opacité de base (max) — distinct de la
 *    sélection qui, elle, pose l'exergue orange ;
 *  - couleur : un élément dont la teinte de base est BLANCHE (« Type non
 *    déterminé », « Sans indicateur ») vire au gris clair au survol, sinon le
 *    hover serait invisible sur fond clair.
 */

/** Expression MapLibre : true quand la feature est survolée. */
export const HOVER_STATE_EXPRESSION: unknown[] = [
  "boolean",
  ["feature-state", "hover"],
  false,
];

/** Gris clair de survol des teintes blanches (token DS border-subtle). */
export const HOVER_NEUTRAL_GRAY_FALLBACK = "#cbd5e1";

/**
 * Enveloppe une expression (ou constante) d'OPACITÉ : au survol, l'opacité est
 * remontée à au moins `hoverMinOpacity` (sans jamais réduire une opacité de
 * base plus forte, ex. sélection à 0.85).
 */
export function withHoverOpacityBoost(
  base: unknown,
  hoverMinOpacity: number,
): unknown {
  return [
    "case",
    HOVER_STATE_EXPRESSION,
    ["max", base, hoverMinOpacity],
    base,
  ];
}

/**
 * Enveloppe une expression de COULEUR : au survol, si la couleur de base vaut
 * `neutralColor` (le blanc résolu des éléments sans teinte), elle devient
 * `hoverGray` (gris clair). Les autres teintes restent inchangées — leur
 * accentuation passe par l'opacité.
 */
export function withHoverNeutralTint(
  baseColor: unknown,
  neutralColor: string,
  hoverGray: string = HOVER_NEUTRAL_GRAY_FALLBACK,
): unknown {
  return [
    "case",
    ["all", HOVER_STATE_EXPRESSION, ["==", baseColor, neutralColor]],
    hoverGray,
    baseColor,
  ];
}
