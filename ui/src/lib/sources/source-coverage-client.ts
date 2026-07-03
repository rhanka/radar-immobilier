/**
 * source-coverage-client — client + helpers PURS de la vue « Source » (qualité
 * de données e2e, choropleth honnête).
 *
 * Contrat : GET /api/source/coverage (api/src/routes/source-coverage.ts). Chaque
 * couche (PV collectés / signaux extraits / zones servies / normes (grilles) /
 * lots (cadastre) / TOD) est un TRI-ÉTAT
 *   - `verified` : substantié LIVE (preuve en base OU collection listée live
 *                  par l'API géo au moment de la requête).
 *   - `declared` : déclaré mais NON substantié (statut annoncé, rien en base).
 *   - `absent`   : rien de connu.
 * Zonage/lots/TOD « servis » sont mesurés sur le LISTING LIVE de l'API géo (ce
 * que la carte sert réellement), avec repli honnête sur le store local.
 *
 * Statut agrégé (`worstStatus`, couleur carte + badge « Couverture ») :
 *   - `verified` (« Servi »)       : couches CŒUR (PV, signaux, zonage, lots)
 *                                    toutes substantiées live.
 *   - `declared` (« Partiel »)     : au moins une couche servie, pas toutes.
 *   - `absent`   (« Non couvert ») : aucune couche servie.
 * Anti-survente (D2) : JAMAIS un score 0-100, JAMAIS de vert fabriqué. Une ville
 * sans couverture connue est `absent` (gris neutre), pas une erreur, pas du vert.
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

export interface SignalsCell {
  state: CoverageState;
  /** Signaux projetés en base (Signal + DesignationEvent). */
  count: number;
  /** Dont porteurs d'une citation/extrait vérifiable. */
  withCitation: number;
  freshness: Freshness;
}

export interface GeoCell {
  state: CoverageState;
  served: boolean;
  /** Preuve du servi : listing live de l'API géo (`geo`) ou store local. */
  servedBy: "geo" | "local" | null;
  freshness: Freshness;
}

/**
 * Normes (grilles de zonage) au niveau bulk : `absent` tant qu'aucune grille
 * n'est prouvée (la mesure fine reste LAZY au détail ville — donnée éparse,
 * « Non couvert » majoritaire honnête).
 */
export interface NormesCell {
  state: CoverageState;
  freshness: Freshness;
}

export interface CityCoverage {
  citySlug: string;
  cityName: string;
  mrc: string | null;
  priorityRank: number | null;
  l1Raw: RawCell;
  l2Graph: GraphCell;
  signals: SignalsCell;
  l4Zonage: GeoCell;
  normes: NormesCell;
  l5Lots: GeoCell;
  /** Périmètres TOD servis (collection `qc-tod-<slug>` du listing live géo). */
  tod: GeoCell;
  worstStatus: CoverageState;
  nextMarginalGain: "zonage" | "lots" | null;
}

export interface CoverageTotals {
  cities: number;
  l1Raw: number;
  l2Graph: number;
  signals: number;
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

// ── Détail grilles de zonage par ville (lazy, mesuré LIVE côté API) ──────────

/**
 * Contrat : GET /api/source/coverage/:citySlug/grilles. `available: false` =
 * l'API géo est injoignable (état « donnée indisponible » HONNÊTE, jamais un
 * faux « Non couvert »). Donnée éparse aujourd'hui : `state: "absent"` signifie
 * réellement « aucune grille publiée sur les zones servies ».
 */
export interface CityGrilles {
  citySlug: string;
  available: boolean;
  zoneCount?: number;
  zonesWithGrille?: number;
  zonesWithNormes?: number;
  /** Zones portant une grille OU des normes réelles. */
  covered?: number;
  state?: CoverageState;
}

/** Récupère le détail grilles d'une ville. Lève en cas d'échec HTTP. */
export async function fetchCityGrilles(
  citySlug: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CityGrilles> {
  const res = await fetchImpl(
    `${COVERAGE_URL}/${encodeURIComponent(citySlug)}/grilles`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) {
    throw new Error(`source-coverage grilles HTTP ${res.status}`);
  }
  return (await res.json()) as CityGrilles;
}

// ── Tri-état : couleurs + libellés (3 états DISTINCTS, D2) ────────────────────

/**
 * Couleur de l'aplat ville = statut agrégé honnête. Trois couleurs DISTINCTES :
 *   verified → vert (couches cœur complètes), declared → ambre (couverture
 *   partielle), absent → gris neutre (rien de servi). JAMAIS de score continu.
 */
export const STATE_COLOR: Record<CoverageState, string> = {
  verified: "#16a34a", // green-600 — « Servi »
  declared: "#f59e0b", // amber-500 — « Partiel »
  absent: "#cbd5e1", // slate-300 — « Non couvert » (neutre, PAS du vert)
};

/**
 * Libellé CLIENT tri-état (badges / légende / scorecard). Copy produit neutre —
 * aucun jargon interne. La rigueur reste la même (couleur = pire état réel),
 * seuls les MOTS changent :
 *   verified → « Servi », declared → « Partiel », absent → « Non couvert ».
 */
export const STATE_LABEL: Record<CoverageState, string> = {
  verified: "Servi",
  declared: "Partiel",
  absent: "Non couvert",
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

/** Couleur de l'aplat d'une ville = couleur de son statut agrégé honnête. */
export function colorForCity(city: CityCoverage): string {
  return STATE_COLOR[city.worstStatus];
}

// ── Expression choroplèthe MapLibre (couleur = statut agrégé) ─────────────────

/**
 * Expression `fill-color` MapLibre : `match` sur `citySlug` → couleur du statut
 * agrégé honnête de la ville. Le fallback est la couleur `absent` : une ville
 * présente dans le geojson mais ABSENTE de la couverture est peinte `absent`
 * (honnête), jamais en vert, jamais en erreur.
 */
export function buildFillColorExpression(
  cities: CityCoverage[],
): ExpressionSpecification {
  // Sans couverture (chargement / erreur / réponse vide) on NE PEUT PAS bâtir un
  // `match` valide : MapLibre exige au moins une paire label→couleur, et un
  // `["match", input, fallback]` sans paire est REJETÉ (« Expected at least 4
  // arguments »). Poser cette expression invalide sur `cities-fill` fait échouer
  // la couche → aucun aplat ne se peint. On retombe donc sur une COULEUR
  // CONSTANTE « absent » (gris neutre) : valeur de paint valide ET honnête (tout
  // est « Non couvert » tant qu'on n'a pas la donnée, jamais de vert fabriqué).
  if (cities.length === 0) {
    return STATE_COLOR.absent as unknown as ExpressionSpecification;
  }
  const expr: unknown[] = ["match", ["get", "citySlug"]];
  for (const city of cities) {
    expr.push(city.citySlug, STATE_COLOR[city.worstStatus]);
  }
  // Fallback : villes sans couverture connue → ABSENT (gris neutre, honnête).
  expr.push(STATE_COLOR.absent);
  return expr as ExpressionSpecification;
}

// ── Focus 30 = les 30 villes À SIGNAUX (présence de signaux, PAS la proximité) ─

/**
 * Taille du périmètre « Focus 30 » (carte Couverture + Console).
 */
export const FOCUS_CITY_COUNT = 30;

/**
 * Périmètre « Focus 30 » calculé sur les DONNÉES de couverture.
 *
 * DÉFINITION (corrigée 2026-07, bug signalé par Steve) : le focus-30 = les 30
 * villes qui ONT des signaux projetés (`signals.count > 0` — Signal +
 * DesignationEvent, la matière de la vue Signaux et de ses 3 filtres
 * zonage / multifamilial 4+ / précoce), classées par NOMBRE de signaux
 * décroissant. Ce n'est PLUS `priorityRank ≤ 30` (proximité de Montréal) :
 * ce critère incluait des villes proches SANS aucun signal (ex. Kirkland,
 * Brossard — 0 signal) et excluait des villes à signaux éloignées
 * (ex. Mont-Tremblant, 13 signaux, rang proximité 351).
 *
 * Une ville sans signal n'est JAMAIS focus, quel que soit son priorityRank.
 * La portée « Focus QA : 4 villes » (REFERENCE_CITIES de la carte Steve) est
 * un périmètre distinct et n'est pas affectée.
 */
export interface FocusScope {
  /** Slugs du focus (top `FOCUS_CITY_COUNT` villes à signaux). */
  slugs: ReadonlySet<string>;
  /** Rang 1..N par nombre de signaux (villes à signaux uniquement). */
  rankBySlug: ReadonlyMap<string, number>;
}

/**
 * Construit le périmètre focus depuis la réponse de couverture :
 * villes `signals.count > 0`, triées par `signals.count` décroissant
 * (tie-break : priorityRank croissant puis nom — ordre STABLE), tronquées à
 * `limit`. Réponse vide / aucune ville à signaux → focus vide (honnête).
 */
export function computeFocusScope(
  cities: CityCoverage[],
  limit: number = FOCUS_CITY_COUNT,
): FocusScope {
  const withSignals = cities
    .filter((c) => c.signals.count > 0)
    .sort((a, b) => {
      if (b.signals.count !== a.signals.count) {
        return b.signals.count - a.signals.count;
      }
      const ra = a.priorityRank ?? Number.POSITIVE_INFINITY;
      const rb = b.priorityRank ?? Number.POSITIVE_INFINITY;
      if (ra !== rb) return ra - rb;
      return a.cityName.localeCompare(b.cityName, "fr");
    });
  const rankBySlug = new Map<string, number>();
  withSignals.forEach((c, i) => rankBySlug.set(c.citySlug, i + 1));
  return {
    slugs: new Set(withSignals.slice(0, limit).map((c) => c.citySlug)),
    rankBySlug,
  };
}

/**
 * Une ville est-elle dans le focus-30 ? Critère : PRÉSENCE DE SIGNAUX (top 30
 * par `signals.count` via `computeFocusScope`), plus jamais `priorityRank ≤ 30`.
 */
export function isFocusCity(city: CityCoverage, scope: FocusScope): boolean {
  return scope.slugs.has(city.citySlug);
}

/**
 * Expression `fill-opacity` MapLibre. Deux régimes (D3) :
 *   - `focusOnly=false` (Province) : opacité uniforme, les 1104 villes visibles.
 *   - `focusOnly=true`  (Focus 30) : surbrillance des 30 villes À SIGNAUX
 *     (`computeFocusScope`, top 30 par nombre de signaux), le reste de la
 *     province atténué. C'est un HIGHLIGHT visuel (pas un recompute, pas un
 *     filtre de données).
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
  const scope = computeFocusScope(cities);
  const expr: unknown[] = ["match", ["get", "citySlug"]];
  for (const city of cities) {
    expr.push(
      city.citySlug,
      isFocusCity(city, scope) ? FOCUS_OPACITY : DIMMED_OPACITY,
    );
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
 * proximité (priorityRank) avant le reste, puis alpha. Met en avant les villes
 * qui demandent une action, sans cacher l'honnêteté du tri-état. NB : le
 * priorityRank n'est ici qu'un ordre d'affichage secondaire — le périmètre
 * « Focus 30 », lui, se base sur la présence de signaux (computeFocusScope).
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
