/**
 * score-color-scale — Rampe de couleur du score de potentiel par lot, DÉRIVÉE
 * des TOKENS du design-system (aucune palette inventée).
 *
 * Contrainte produit (LOT carto) : INTERDIT de fabriquer un fichier de style
 * maison avec des hex en dur. Toute couleur vient des tokens sémantiques
 * `@sentropic/design-system` exposés en variables CSS par le thème
 * (`--st-semantic-*`, cf. `@sentropic/design-system-themes/css/sent-tech.css`).
 *
 * ## Échelle : 0–10 (scorer canonique lot-potential.ts, PR #165)
 * Les stops correspondent aux paliers significatifs du scorer canonique 0-10 :
 *   0.0  aucun potentiel       → --st-semantic-text-muted      (gris neutre)
 *   2.0  faible (zone C/I/P)   → --st-semantic-feedback-info   (bleu info)
 *   4.0  moyen (zone H ou H+TOD ou mixte) → --st-semantic-feedback-success (vert)
 *   7.0  fort (H+TOD+bonusReconv ou MIXTE+TOD) → --st-semantic-feedback-warning (ambre)
 *  10.0  max théorique         → --st-semantic-feedback-warning (ambre)
 *
 * Au runtime, on résout la valeur de chaque token via `getComputedStyle` sur un
 * élément (généralement le conteneur de carte, sous le `ThemeProvider`), puis on
 * construit l'expression MapLibre `interpolate` avec les couleurs RÉSOLUES. Si le
 * DOM n'est pas disponible (SSR/test sans document), on retombe sur la valeur
 * documentée du token `sent-tech` — toujours une valeur de TOKEN, jamais une
 * couleur inventée hors design-system.
 */

/** Type minimal d'une expression MapLibre (évite la dépendance de type au build). */
export type StyleExpression = unknown[];

/** Un point de la rampe : seuil de score [0,10] + token DS + libellé légende. */
export interface ScoreStop {
  stop: number;
  /** Nom de la variable CSS du token DS (sans la valeur). */
  token: string;
  /** Valeur du token dans le thème `sent-tech` — fallback hors DOM uniquement. */
  fallback: string;
  /** Libellé de légende (FR). */
  label: string;
}

/**
 * Rampe du score [0-10] → token DS. L'ordre des stops est croissant.
 * `fallback` reflète la valeur `sent-tech` du token (cf. sent-tech.css) ; elle
 * n'est utilisée que lorsque `getComputedStyle` n'est pas disponible.
 *
 * Correspondance scorer canonique (PR #165 lot-potential.ts) :
 *   score=0   : aucune composante (zone absente / AUTRE)
 *   score=2-3 : zone H seule (scoreBase=1 + bonusKind=1, sans TOD)
 *   score=3-4 : zone H+TOD (scoreBase=1 + bonusKind=1 + bonusTod=1)
 *   score=4-5 : zone MIXTE (scoreBase=2 + bonusKind=1, sans TOD)
 *   score=5-7 : combinaisons fortes (MIXTE+TOD, H+TOD+reconvertible…)
 */
export const SCORE_STOPS: ScoreStop[] = [
  { stop: 0, token: "--st-semantic-text-muted", fallback: "#64748b", label: "Aucun potentiel détecté" },
  { stop: 2, token: "--st-semantic-feedback-info", fallback: "#2563eb", label: "Faible potentiel (zone C/I/P)" },
  { stop: 4, token: "--st-semantic-feedback-success", fallback: "#16a34a", label: "Potentiel modéré (zone H ou mixte)" },
  { stop: 7, token: "--st-semantic-feedback-warning", fallback: "#d97706", label: "Fort potentiel (H+TOD ou MIXTE+TOD)" },
  { stop: 10, token: "--st-semantic-feedback-warning", fallback: "#d97706", label: "Priorité maximale" },
];

/** Token DS du contour de lot prioritaire (accent fort). */
export const PRIORITY_LINE_TOKEN = "--st-semantic-feedback-warning";
export const PRIORITY_LINE_FALLBACK = "#d97706";
/** Token DS du contour de lot ordinaire. */
export const DEFAULT_LINE_TOKEN = "--st-semantic-action-primary";
export const DEFAULT_LINE_FALLBACK = "#2563eb";

/**
 * Résout la valeur calculée d'un token CSS DS depuis un élément monté.
 * Retourne `fallback` si le DOM/document n'est pas disponible ou si le token
 * est vide.
 */
export function resolveToken(token: string, fallback: string, el?: Element | null): string {
  if (typeof window === "undefined" || typeof getComputedStyle === "undefined") {
    return fallback;
  }
  const target = el ?? (typeof document !== "undefined" ? document.documentElement : null);
  if (!target) return fallback;
  const v = getComputedStyle(target).getPropertyValue(token).trim();
  return v.length > 0 ? v : fallback;
}

/**
 * Construit l'expression MapLibre `interpolate` qui colorie un lot par sa
 * propriété `potentialScore` ∈ [0,10], avec les couleurs RÉSOLUES depuis les
 * tokens DS de `el`.
 *
 * Produit : ["interpolate", ["linear"], ["get","potentialScore"], 0,c0, ...].
 * Aucune couleur calculée en JS par feature : le moteur de rendu interpole, ce
 * qui tient à l'échelle (>200 lots) là où l'ancien SVG capait à 200.
 */
export function lotFillColorExpression(el?: Element | null): StyleExpression {
  const expr: unknown[] = ["interpolate", ["linear"], ["get", "potentialScore"]];
  for (const s of SCORE_STOPS) {
    expr.push(s.stop, resolveToken(s.token, s.fallback, el));
  }
  return expr;
}

/** Opacité data-driven : les lots prioritaires ressortent plus fort. */
export function lotFillOpacityExpression(): StyleExpression {
  return ["case", ["get", "priorite"], 0.75, 0.4];
}

/** Couleur du contour de lot (priorité = token warning, sinon token primary). */
export function lotLineColorExpression(el?: Element | null): StyleExpression {
  return [
    "case",
    ["get", "priorite"],
    resolveToken(PRIORITY_LINE_TOKEN, PRIORITY_LINE_FALLBACK, el),
    resolveToken(DEFAULT_LINE_TOKEN, DEFAULT_LINE_FALLBACK, el),
  ];
}

/** Couleur résolue en JS pour un score [0-10] (légende/tests, PAS le rendu de masse). */
export function colorForScore(score: number, el?: Element | null): string {
  const s = Number.isFinite(score) ? Math.min(10, Math.max(0, score)) : 0;
  let prev = SCORE_STOPS[0];
  for (const cur of SCORE_STOPS) {
    if (s <= cur.stop) {
      const a = resolveToken(prev.token, prev.fallback, el);
      const b = resolveToken(cur.token, cur.fallback, el);
      if (cur.stop === prev.stop) return b;
      return lerpHex(a, b, (s - prev.stop) / (cur.stop - prev.stop));
    }
    prev = cur;
  }
  const last = SCORE_STOPS[SCORE_STOPS.length - 1];
  return resolveToken(last.token, last.fallback, el);
}

/** Entrée de légende : couleur résolue + libellé. Ordre décroissant (priorité en haut). */
export interface LegendEntry {
  color: string;
  label: string;
}

export function scoreLegend(el?: Element | null): LegendEntry[] {
  return [...SCORE_STOPS]
    .reverse()
    .map((s) => ({ color: resolveToken(s.token, s.fallback, el), label: s.label }));
}

/** Zoom minimal d'apparition des labels de zone (parité avec la référence). */
export const ZONE_LABEL_MINZOOM = 14;

// ── Interpolation hex (uniquement entre deux couleurs de TOKENS) ──────────────
// Ne sert qu'à `colorForScore`/légende ; le rendu de masse passe par MapLibre.

function lerpHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  if (!ca || !cb) return t < 0.5 ? a : b; // tokens non-hex (ex. oklch) : pas d'interpolation
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
  return `#${[r, g, bl].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1];
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}
