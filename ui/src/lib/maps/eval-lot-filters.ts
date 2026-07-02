/**
 * eval-lot-filters — filtres combinés + peinture filter-aware de la vue
 * Évaluation (parité carte de référence CS-L6).
 *
 * ## Modèle de filtre (parité concurrent)
 * - Catégorie EXCLUSIVE : Tout / 4+ logements / TOD / Priorité.
 * - Usage ADDITIF (toggles) : Résidentiel, Multi-logements, Commercial,
 *   Industriel, Mixte, Public, Vacant. Ensemble vide = tous les usages.
 * - Superficie minimale (m²) : 0 = pas de contrainte.
 * Chaque changement = recalcul de style PUR (aucun refetch).
 *
 * ## Peinture (hiérarchie concurrent, tokens DS uniquement)
 *   marques équipe > priorité (ambre) > 4+ (vert) > TOD (bleu) > rampe score.
 * Les lots NON matchés par le filtre restent VISIBLES mais estompés
 * (opacité ~0.15 vs 0.4–0.85) — jamais supprimés de la carte.
 *
 * Toutes les couleurs viennent des tokens sémantiques du design-system
 * (`resolveToken`, cf. score-color-scale) — aucune palette inventée.
 *
 * ## Dégradé honnête
 * Quand une donnée manque (pas de flag TOD/4+, pas d'usage résolu, pas de
 * superficie), le lot ne matche PAS le filtre correspondant — on n'invente
 * rien. Le groupe d'usage est résolu depuis les champs publics disponibles
 * (catégorie du rôle, code CUBF, nb logements) et retourne null sinon.
 */

import type { LotProperties } from "./lots-client.js";
import {
  colorForScore,
  resolveToken,
  PRIORITY_LINE_TOKEN,
  PRIORITY_LINE_FALLBACK,
  LOT_4PLUS_TOD_TOKEN,
  LOT_4PLUS_TOD_FALLBACK,
} from "./score-color-scale.js";

// ── Tokens de la hiérarchie (parité concurrent, valeurs DS) ───────────────────

/** Marque équipe active (favori/sollicité/en vente…) — accent le plus fort. */
export const EVAL_MARKED_TOKEN = "--st-semantic-error";
export const EVAL_MARKED_FALLBACK = "#ef4444";
/** Priorité (concurrent : orange). */
export const EVAL_PRIORITE_TOKEN = PRIORITY_LINE_TOKEN;
export const EVAL_PRIORITE_FALLBACK = PRIORITY_LINE_FALLBACK;
/** Multifamilial 4+ (concurrent : vert). */
export const EVAL_4PLUS_TOKEN = LOT_4PLUS_TOD_TOKEN;
export const EVAL_4PLUS_FALLBACK = LOT_4PLUS_TOD_FALLBACK;
/** Périmètre TOD (concurrent : bleu). */
export const EVAL_TOD_TOKEN = "--st-semantic-feedback-info";
export const EVAL_TOD_FALLBACK = "#2563eb";

// ── Catégories exclusives ─────────────────────────────────────────────────────

export type EvalCategory = "all" | "quatrePlus" | "tod" | "priorite";

export const EVAL_CATEGORIES: Array<{ id: EvalCategory; label: string }> = [
  { id: "all", label: "Tout" },
  { id: "quatrePlus", label: "4+ logements" },
  { id: "tod", label: "TOD" },
  { id: "priorite", label: "Priorité" },
];

export function evalCategoryLabel(category: EvalCategory): string {
  return EVAL_CATEGORIES.find((c) => c.id === category)?.label ?? category;
}

// ── Groupes d'usage (toggle additif) ─────────────────────────────────────────

export type UsageGroup =
  | "residentiel"
  | "multi"
  | "commercial"
  | "industriel"
  | "mixte"
  | "public"
  | "vacant";

export const USAGE_GROUPS: Array<{ id: UsageGroup; label: string }> = [
  { id: "residentiel", label: "Résidentiel" },
  { id: "multi", label: "Multi-logements" },
  { id: "commercial", label: "Commercial" },
  { id: "industriel", label: "Industriel" },
  { id: "mixte", label: "Mixte" },
  { id: "public", label: "Public" },
  { id: "vacant", label: "Vacant" },
];

/** État complet des filtres de la vue Évaluation. */
export interface EvalLotFilter {
  category: EvalCategory;
  /** Groupes d'usage retenus. Vide = tous. */
  usages: ReadonlySet<UsageGroup>;
  /** Superficie minimale en m². 0 = pas de contrainte. */
  superficieMin: number;
}

export const DEFAULT_EVAL_FILTER: EvalLotFilter = {
  category: "all",
  usages: new Set<UsageGroup>(),
  superficieMin: 0,
};

export function isDefaultEvalFilter(filter: EvalLotFilter): boolean {
  return (
    filter.category === "all" && filter.usages.size === 0 && filter.superficieMin <= 0
  );
}

// ── Prédicats par lot ─────────────────────────────────────────────────────────

export function isQuatrePlus(properties: LotProperties): boolean {
  return properties.multifamilial4plus === true;
}

export function isTod(properties: LotProperties): boolean {
  return properties.tod === true;
}

/**
 * Priorité : flag `priorite` de la source quand présent (parité concurrent),
 * sinon intersection 4+∩TOD (le critère CS-L1). Pas d'invention : sans flag
 * ni intersection, le lot n'est pas prioritaire.
 */
export function isPriorite(properties: LotProperties): boolean {
  if (properties.priorite === true) return true;
  return isQuatrePlus(properties) && isTod(properties);
}

/**
 * Opacité PAR DÉFAUT d'un lot selon la hiérarchie concurrente (mécanique
 * getLotOpacity) : les lots à flags ressortent en permanence, sans filtre
 * actif — priorité 0.5 > 4+ 0.4 > TOD 0.25 > neutre 0.15 (substrat discret).
 */
export const LOT_HIERARCHY_OPACITY = {
  priorite: 0.5,
  quatrePlus: 0.4,
  tod: 0.25,
  neutral: 0.15,
} as const;

export function lotHierarchyOpacity(properties: LotProperties): number {
  if (isPriorite(properties)) return LOT_HIERARCHY_OPACITY.priorite;
  if (isQuatrePlus(properties)) return LOT_HIERARCHY_OPACITY.quatrePlus;
  if (isTod(properties)) return LOT_HIERARCHY_OPACITY.tod;
  return LOT_HIERARCHY_OPACITY.neutral;
}

/** Retire les accents pour comparer des libellés FR de façon robuste. */
function foldLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Résout le groupe d'usage d'un lot depuis les champs PUBLICS disponibles.
 *
 * Ordre de résolution (documenté, dégradé honnête) :
 *  1. libellé de catégorie du rôle (`valuation.categorie`) — le plus fiable ;
 *  2. code CUBF (`usageCode` / `valuation.usageCode`) par 1er chiffre :
 *     1=résidentiel, 2-4=industriel/infrastructures, 5-6=commercial,
 *     7=public (loisirs/culture), 9=vacant ;
 *  3. « multi » est promu depuis résidentiel quand nbLogements ≥ 4.
 * Retourne null quand rien n'est résolu — le lot ne matche alors PAS un
 * filtre d'usage actif (aucune invention).
 */
export function lotUsageGroup(properties: LotProperties): UsageGroup | null {
  const nbLogements = properties.valuation?.nbLogements ?? null;
  const label = properties.valuation?.categorie ?? null;

  let group: UsageGroup | null = null;
  if (label) {
    const folded = foldLabel(label);
    if (folded.includes("multi")) group = "multi";
    else if (folded.includes("resident")) group = "residentiel";
    else if (folded.includes("mixte")) group = "mixte";
    else if (folded.includes("commer")) group = "commercial";
    else if (folded.includes("indust")) group = "industriel";
    else if (
      folded.includes("public") ||
      folded.includes("institution") ||
      folded.includes("gouvern") ||
      folded.includes("recreat") ||
      folded.includes("loisir")
    ) {
      group = "public";
    } else if (folded.includes("vacant") || folded.includes("vague")) {
      group = "vacant";
    }
  }

  if (group === null) {
    const cubf = properties.valuation?.usageCode ?? properties.usageCode ?? null;
    const firstDigit = cubf?.trim().charAt(0) ?? "";
    if (firstDigit === "1") group = "residentiel";
    else if (firstDigit === "2" || firstDigit === "3" || firstDigit === "4") group = "industriel";
    else if (firstDigit === "5" || firstDigit === "6") group = "commercial";
    else if (firstDigit === "7") group = "public";
    else if (firstDigit === "9") group = "vacant";
  }

  // Promotion multi : résidentiel avec 4+ logements au rôle.
  if (group === "residentiel" && nbLogements !== null && nbLogements >= 4) {
    group = "multi";
  }
  return group;
}

// ── Matching combiné ──────────────────────────────────────────────────────────

/** true si le lot matche la catégorie exclusive du filtre. */
export function matchesCategory(properties: LotProperties, category: EvalCategory): boolean {
  switch (category) {
    case "all":
      return true;
    case "quatrePlus":
      return isQuatrePlus(properties);
    case "tod":
      return isTod(properties);
    case "priorite":
      return isPriorite(properties);
  }
}

/**
 * Matching combiné : catégorie exclusive × usages additifs × superficie min.
 * Dégradé honnête : donnée absente ⇒ ne matche pas la contrainte active.
 */
export function lotMatchesEvalFilter(
  properties: LotProperties,
  filter: EvalLotFilter,
): boolean {
  if (!matchesCategory(properties, filter.category)) return false;

  if (filter.usages.size > 0) {
    const group = lotUsageGroup(properties);
    if (group === null || !filter.usages.has(group)) return false;
  }

  if (filter.superficieMin > 0) {
    const superficie = properties.superficieM2 ?? null;
    if (superficie === null || superficie < filter.superficieMin) return false;
  }

  return true;
}

/** Compte les lots matchés (pour la légende « N / M »). */
export function countEvalMatches(
  features: ReadonlyArray<{ properties: LotProperties }>,
  filter: EvalLotFilter,
): number {
  let count = 0;
  for (const feature of features) {
    if (lotMatchesEvalFilter(feature.properties, filter)) count += 1;
  }
  return count;
}

// ── Peinture par lot (SVG) ────────────────────────────────────────────────────

export interface EvalLotPaintContext {
  /** Le lot matche le filtre courant. */
  matched: boolean;
  /** Le lot est sélectionné (fiche ouverte). */
  selected: boolean;
  /** Le lot est survolé. */
  hovered: boolean;
  /** Le lot porte une marque équipe active (pipeline ou marché). */
  marked: boolean;
  /** Élément DOM pour résoudre les tokens DS (fallbacks sinon). */
  el?: Element | null;
}

export interface EvalLotPaint {
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
}

/** Couleur de la hiérarchie concurrent : marques > priorité > 4+ > TOD > score. */
export function evalLotFillColor(
  properties: LotProperties,
  marked: boolean,
  el?: Element | null,
): string {
  if (marked) return resolveToken(EVAL_MARKED_TOKEN, EVAL_MARKED_FALLBACK, el);
  if (isPriorite(properties)) {
    return resolveToken(EVAL_PRIORITE_TOKEN, EVAL_PRIORITE_FALLBACK, el);
  }
  if (isQuatrePlus(properties)) {
    return resolveToken(EVAL_4PLUS_TOKEN, EVAL_4PLUS_FALLBACK, el);
  }
  if (isTod(properties)) return resolveToken(EVAL_TOD_TOKEN, EVAL_TOD_FALLBACK, el);
  const score = properties.potentialScore;
  return colorForScore(
    typeof score === "number" && Number.isFinite(score) ? score : 0,
    el ?? null,
  );
}

/**
 * Style complet d'un lot : matchés opaques + bordure renforcée, non-matchés
 * estompés (opacité 0.15) mais TOUJOURS visibles. La sélection garde son
 * accent (bordure épaisse) au-dessus de tout.
 */
export function evalLotPaint(
  properties: LotProperties,
  ctx: EvalLotPaintContext,
): EvalLotPaint {
  const fill = evalLotFillColor(properties, ctx.marked, ctx.el);
  const hierarchyHit =
    ctx.marked || isPriorite(properties) || isQuatrePlus(properties) || isTod(properties);

  if (!ctx.matched && !ctx.selected) {
    return {
      fill,
      fillOpacity: ctx.hovered ? 0.3 : 0.15,
      stroke: fill,
      strokeWidth: 0.4,
      strokeOpacity: 0.3,
    };
  }

  const fillOpacity = ctx.selected
    ? 0.85
    : ctx.hovered
      ? 0.8
      : hierarchyHit
        ? 0.72
        : (properties.potentialScore ?? 0) > 0
          ? 0.62
          : 0.4;

  return {
    fill,
    fillOpacity,
    stroke: fill,
    strokeWidth: ctx.selected ? 1.6 : hierarchyHit ? 1.2 : 0.8,
    strokeOpacity: 0.95,
  };
}

// ── Légende de la hiérarchie (MapLegend) ─────────────────────────────────────

export interface EvalHierarchyLegendEntry {
  color: string;
  label: string;
}

/** Entrées de légende de la hiérarchie, couleurs résolues depuis les tokens DS. */
export function evalHierarchyLegend(el?: Element | null): EvalHierarchyLegendEntry[] {
  return [
    { color: resolveToken(EVAL_MARKED_TOKEN, EVAL_MARKED_FALLBACK, el), label: "Marqué (équipe)" },
    { color: resolveToken(EVAL_PRIORITE_TOKEN, EVAL_PRIORITE_FALLBACK, el), label: "Priorité" },
    { color: resolveToken(EVAL_4PLUS_TOKEN, EVAL_4PLUS_FALLBACK, el), label: "Multifamilial 4+" },
    { color: resolveToken(EVAL_TOD_TOKEN, EVAL_TOD_FALLBACK, el), label: "Périmètre TOD" },
  ];
}
