/**
 * source-coverage-client — client + helpers PURS de la vue « Source » (qualité
 * de données e2e, choropleth honnête).
 *
 * Contrat : GET /api/source/coverage (api/src/routes/source-coverage.ts). Chaque
 * couche (L1 raw / L2 graphe / L4 zonage servi / L5 lots servis) est un TRI-ÉTAT
 *   - `verified` : substantié LIVE (preuve en base au moment de la requête).
 *   - `declared` : déclaré mais NON substantié (statut annoncé, rien en base).
 *   - `absent`   : rien de connu.
 *
 * Anti-survente (D2) : la couleur de ville = le PIRE statut honnête de sa chaîne
 * (`worstStatus`). JAMAIS un score 0-100, JAMAIS de vert fabriqué. Une ville sans
 * couverture connue est `absent` (gris neutre), pas une erreur, pas du vert.
 */
import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";

// ── Contrat de l'endpoint (shape EXACT) ──────────────────────────────────────

export type CoverageState = "verified" | "declared" | "absent";
export type Freshness = "fresh" | "partial" | "stale" | "unknown";

export interface RawCell {
  state: CoverageState;
  count: number;
  freshness: Freshness;
}

export interface GraphCell {
  state: CoverageState;
  ontologyVersion: string | null;
  freshness: Freshness;
}

export interface GeoCell {
  state: CoverageState;
  served: boolean;
  freshness: Freshness;
}

export interface CityCoverage {
  citySlug: string;
  cityName: string;
  mrc: string | null;
  priorityRank: number | null;
  l1Raw: RawCell;
  l2Graph: GraphCell;
  l4Zonage: GeoCell;
  l5Lots: GeoCell;
  worstStatus: CoverageState;
  nextMarginalGain: "zonage" | "lots" | null;
}

export interface CoverageTotals {
  cities: number;
  l1Raw: number;
  l2Graph: number;
  l4Zonage: number;
  l5Lots: number;
}

export interface CoverageResponse {
  generatedAt: string;
  totals: CoverageTotals;
  cities: CityCoverage[];
}

// ── Fetch ────────────────────────────────────────────────────────────────────

const COVERAGE_URL = "/api/source/coverage";

/**
 * Récupère la couverture qualité province-wide. Lève en cas d'échec HTTP : la
 * vue affiche alors un état d'erreur HONNÊTE (jamais de faux zéro/vert).
 */
export async function fetchSourceCoverage(
  fetchImpl: typeof fetch = fetch,
): Promise<CoverageResponse> {
  const res = await fetchImpl(COVERAGE_URL, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`source-coverage HTTP ${res.status}`);
  }
  return (await res.json()) as CoverageResponse;
}

// ── Tri-état : couleurs + libellés (3 états DISTINCTS, D2) ────────────────────

/**
 * Couleur de l'aplat ville = pire statut honnête. Trois couleurs DISTINCTES :
 *   verified → vert (substantié live), declared → ambre (déclaré non
 *   substantié), absent → gris neutre (rien de connu). JAMAIS de score continu.
 */
export const STATE_COLOR: Record<CoverageState, string> = {
  verified: "#16a34a", // green-600 — vérifié live
  declared: "#f59e0b", // amber-500 — déclaré non substantié
  absent: "#cbd5e1", // slate-300 — absent (neutre, PAS du vert)
};

/** Libellé tri-état pour badges / légende / scorecard (français, honnête). */
export const STATE_LABEL: Record<CoverageState, string> = {
  verified: "vérifié live",
  declared: "déclaré non substantié",
  absent: "absent",
};

/** Tonalité DS du badge tri-état (success/warning/neutral). */
export const STATE_BADGE_TONE: Record<
  CoverageState,
  "success" | "warning" | "neutral"
> = {
  verified: "success",
  declared: "warning",
  absent: "neutral",
};

/** Libellé de fraîcheur (français). */
export const FRESHNESS_LABEL: Record<Freshness, string> = {
  fresh: "à jour",
  partial: "partiel",
  stale: "périmé",
  unknown: "—",
};

export function colorForState(state: CoverageState): string {
  return STATE_COLOR[state];
}

/** Couleur de l'aplat d'une ville = couleur de son PIRE statut honnête. */
export function colorForCity(city: CityCoverage): string {
  return STATE_COLOR[city.worstStatus];
}

// ── Expression choroplèthe MapLibre (couleur = pire statut) ───────────────────

/**
 * Expression `fill-color` MapLibre : `match` sur `citySlug` → couleur du pire
 * statut honnête de la ville. Le fallback est la couleur `absent` : une ville
 * présente dans le geojson mais ABSENTE de la couverture est peinte `absent`
 * (honnête), jamais en vert, jamais en erreur.
 */
export function buildFillColorExpression(
  cities: CityCoverage[],
): ExpressionSpecification {
  const expr: unknown[] = ["match", ["get", "citySlug"]];
  for (const city of cities) {
    expr.push(city.citySlug, STATE_COLOR[city.worstStatus]);
  }
  // Fallback : villes sans couverture connue → ABSENT (gris neutre, honnête).
  expr.push(STATE_COLOR.absent);
  return expr as ExpressionSpecification;
}

/** Une ville est-elle dans le focus-30 (priorityRank ≤ 30) ? (D3) */
export function isFocusCity(city: CityCoverage): boolean {
  return city.priorityRank !== null && city.priorityRank <= 30;
}

/**
 * Expression `fill-opacity` MapLibre. Deux régimes (D3) :
 *   - `focusOnly=false` (Province) : opacité uniforme, les 1104 villes visibles.
 *   - `focusOnly=true`  (Focus 30) : surbrillance des villes priorityRank ≤ 30
 *     (opaques), le reste de la province atténué. C'est un HIGHLIGHT visuel
 *     (pas un recompute, pas un filtre de données).
 */
export function buildFocusOpacityExpression(
  cities: CityCoverage[],
  focusOnly: boolean,
): ExpressionSpecification {
  const PROVINCE_OPACITY = 0.62;
  const FOCUS_OPACITY = 0.88;
  const DIMMED_OPACITY = 0.18;
  if (!focusOnly) {
    return PROVINCE_OPACITY as unknown as ExpressionSpecification;
  }
  const expr: unknown[] = ["match", ["get", "citySlug"]];
  for (const city of cities) {
    expr.push(city.citySlug, isFocusCity(city) ? FOCUS_OPACITY : DIMMED_OPACITY);
  }
  // Villes hors couverture : atténuées en mode focus (elles ne sont pas focus).
  expr.push(DIMMED_OPACITY);
  return expr as ExpressionSpecification;
}

// ── Headline province (D7) — le chiffre que veut le principal ─────────────────

export interface ProvinceHeadline {
  cities: number;
  l2Graph: number;
  l4Zonage: number;
  l5Lots: number;
  /** Villes graphées live mais sans zonage servi = complétions « cheap ». */
  cheapZonage: number;
}

/**
 * Construit le headline province à partir des `totals` de l'endpoint + le compte
 * de gains marginaux « cheap » (villes `nextMarginalGain === "zonage"`).
 */
export function buildProvinceHeadline(
  response: Pick<CoverageResponse, "totals" | "cities">,
): ProvinceHeadline {
  return {
    cities: response.totals.cities,
    l2Graph: response.totals.l2Graph,
    l4Zonage: response.totals.l4Zonage,
    l5Lots: response.totals.l5Lots,
    cheapZonage: countCheapZonageCompletions(response.cities),
  };
}

/** Phrase headline : `Y/N graphés · Z/N zonage servi · W/N lots servis`. */
export function formatProvinceHeadline(totals: CoverageTotals): string {
  const n = totals.cities;
  return `${totals.l2Graph}/${n} graphés · ${totals.l4Zonage}/${n} zonage servi · ${totals.l5Lots}/${n} lots servis`;
}

/** Nb de villes dont le prochain gain marginal cheap est le zonage (D7). */
export function countCheapZonageCompletions(cities: CityCoverage[]): number {
  return cities.filter((c) => c.nextMarginalGain === "zonage").length;
}

/** Nb de villes dont le prochain gain marginal cheap est les lots (D7). */
export function countCheapLotsCompletions(cities: CityCoverage[]): number {
  return cities.filter((c) => c.nextMarginalGain === "lots").length;
}

// ── Tri / regroupement pour la Console (table par ville) ──────────────────────

const WORST_RANK: Record<CoverageState, number> = {
  absent: 0,
  declared: 1,
  verified: 2,
};

/**
 * Ordre Console : pires statuts d'abord (absent < declared < verified), puis
 * focus-30 (priorityRank) avant le reste, puis alpha. Met en avant les villes
 * qui demandent une action, sans cacher l'honnêteté du tri-état.
 */
export function sortCitiesForConsole(cities: CityCoverage[]): CityCoverage[] {
  return [...cities].sort((a, b) => {
    if (WORST_RANK[a.worstStatus] !== WORST_RANK[b.worstStatus]) {
      return WORST_RANK[a.worstStatus] - WORST_RANK[b.worstStatus];
    }
    const ra = a.priorityRank ?? Number.POSITIVE_INFINITY;
    const rb = b.priorityRank ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    return a.cityName.localeCompare(b.cityName, "fr");
  });
}
