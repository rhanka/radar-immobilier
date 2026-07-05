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
  /**
   * Dont signaux PRIORITAIRES z∩m∩p : zonage ∩ multifamilial 4+ ∩ précoce
   * (même classification que la vue Signaux, subsetCounts["z|m|p"] côté API).
   * C'est la cohorte « 33 » de l'axe de reporting « 30 villes / 33 signaux
   * précoces » — et le critère du périmètre focus (`computeFocusScope`).
   */
  priority: number;
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

/**
 * Champs LOT enrichis (superficie/adresse/code postal/normes foldées) au niveau
 * bulk : `absent` tant que la mesure lazy per-city (endpoint lot-fields) n'est
 * pas chaude côté API — même contrat que `normes`. Couche INFORMATIVE : elle
 * n'entre pas dans `worstStatus`.
 */
export interface LotFieldsCell {
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
  /**
   * Champs lot enrichis — OPTIONNEL (défensif : payload antérieur au contrat
   * lot-fields → traité comme `absent`).
   */
  lotFields?: LotFieldsCell;
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

// ── Détail champs LOT enrichis par ville (lazy, mesuré LIVE côté API) ─────────

/** Taux d'un champ lot : compte, % honnête (1..99 si partiel), tri-état. */
export interface LotFieldRate {
  count: number;
  pct: number;
  state: CoverageState;
}

/**
 * Contrat : GET /api/source/coverage/:citySlug/lot-fields. Couverture des
 * champs LOT enrichis servis par geo sur `qc-lots-<slug>` : superficie réelle
 * (`surface_m2`), adresse, code postal (FSA), normes foldées au lot
 * (hauteur/densité/façade/superficie min/marges). `available: false` = geo
 * injoignable (état « donnée indisponible » HONNÊTE, jamais un faux 0 %).
 * `sampled: true` = mesure sur ÉCHANTILLON stratifié (les % sont estimés) —
 * la méthode est déclarée, jamais masquée.
 */
export interface CityLotFields {
  citySlug: string;
  available: boolean;
  totalLots?: number | null;
  sampleSize?: number;
  sampled?: boolean;
  fields?: {
    superficie: LotFieldRate;
    adresse: LotFieldRate;
    codePostal: LotFieldRate;
    normes: LotFieldRate;
  };
  state?: CoverageState;
}

/** Récupère le détail champs lot d'une ville. Lève en cas d'échec HTTP. */
export async function fetchCityLotFields(
  citySlug: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CityLotFields> {
  const res = await fetchImpl(
    `${COVERAGE_URL}/${encodeURIComponent(citySlug)}/lot-fields`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) {
    throw new Error(`source-coverage lot-fields HTTP ${res.status}`);
  }
  return (await res.json()) as CityLotFields;
}

/**
 * Évidence client d'un taux de champ lot (copy neutre, % honnête) :
 *   100 % → « 100 % des lots » ; 0 % → « 0 % — non enrichi » ;
 *   partiel → « 70 % des lots ». Le % vient de l'API (déjà borné 1..99 quand
 *   partiel — jamais un « 100 % » fabriqué par arrondi).
 */
export function lotFieldEvidence(rate: LotFieldRate): string {
  if (rate.state === "absent") return "0 % — non enrichi";
  return `${rate.pct} % des lots`;
}

/**
 * Note de MÉTHODE de la mesure champs lot (honnête sur l'échantillonnage) :
 * exhaustive → « mesuré sur les N lots servis » ; échantillon → « échantillon
 * de N lots sur M ». Null si la mesure n'est pas disponible.
 */
export function lotFieldsMethodNote(lf: CityLotFields): string | null {
  if (!lf.available || lf.sampleSize === undefined || lf.sampleSize === 0) {
    return null;
  }
  const n = lf.sampleSize.toLocaleString("fr-CA");
  if (lf.sampled) {
    const total =
      typeof lf.totalLots === "number"
        ? ` sur ${lf.totalLots.toLocaleString("fr-CA")}`
        : "";
    return `échantillon de ${n} lots${total}`;
  }
  return `mesuré sur les ${n} lots servis`;
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

// ── Focus = les villes portant les signaux PRIORITAIRES z∩m∩p ────────────────

/**
 * Périmètre « focus » calculé sur les DONNÉES de couverture.
 *
 * DÉFINITION (axe de reporting « 30 villes / 33 signaux précoces ») : le focus
 * = l'ensemble des villes DISTINCTES qui PORTENT au moins un signal PRIORITAIRE
 * z∩m∩p (`signals.priority > 0`) — zonage ∩ multifamilial 4+ ∩ précoce, la
 * cohorte « 33 » (WPB-E2E). Ce n'est PAS un top-N :
 *   - PAS `priorityRank ≤ 30` (proximité de Montréal — 1er bug, signalé par
 *     Steve : Kirkland/Brossard 0 signal étaient focus, Mont-Tremblant exclue) ;
 *   - PAS un top 30 par NOMBRE de signaux (2e bug : le volume brut n'est pas
 *     le critère — une ville à 400 signaux SANS signal prioritaire n'est pas
 *     focus ; une ville à 1 signal prioritaire l'est).
 * L'ensemble est DATA-DRIVEN : sa taille suit la donnée (~30 villes mesurées,
 * jamais forcée à 30). Une ville sans signal prioritaire n'est JAMAIS focus.
 * La portée « Focus QA : 4 villes » (REFERENCE_CITIES de la carte Steve) est
 * un périmètre distinct et n'est pas affectée.
 */
export interface FocusScope {
  /** Slugs du focus (villes avec ≥ 1 signal prioritaire z∩m∩p). */
  slugs: ReadonlySet<string>;
  /** Rang 1..N par nombre de signaux PRIORITAIRES (villes du focus uniquement). */
  rankBySlug: ReadonlyMap<string, number>;
}

/** Compte de signaux prioritaires z∩m∩p (défensif : payload ancien → 0). */
function prioritySignals(city: CityCoverage): number {
  return city.signals.priority ?? 0;
}

/**
 * Construit le périmètre focus depuis la réponse de couverture : TOUTES les
 * villes `signals.priority > 0` (aucune troncature), classées par nombre de
 * signaux prioritaires décroissant (tie-break : nombre de signaux total
 * décroissant, puis priorityRank croissant, puis nom — ordre STABLE).
 * Réponse vide / aucun signal prioritaire → focus vide (honnête).
 */
export function computeFocusScope(cities: CityCoverage[]): FocusScope {
  const withPriority = cities
    .filter((c) => prioritySignals(c) > 0)
    .sort((a, b) => {
      if (prioritySignals(b) !== prioritySignals(a)) {
        return prioritySignals(b) - prioritySignals(a);
      }
      if (b.signals.count !== a.signals.count) {
        return b.signals.count - a.signals.count;
      }
      const ra = a.priorityRank ?? Number.POSITIVE_INFINITY;
      const rb = b.priorityRank ?? Number.POSITIVE_INFINITY;
      if (ra !== rb) return ra - rb;
      return a.cityName.localeCompare(b.cityName, "fr");
    });
  const rankBySlug = new Map<string, number>();
  withPriority.forEach((c, i) => rankBySlug.set(c.citySlug, i + 1));
  return {
    slugs: new Set(withPriority.map((c) => c.citySlug)),
    rankBySlug,
  };
}

/**
 * Une ville est-elle dans le focus ? Critère : elle PORTE un signal prioritaire
 * z∩m∩p (`computeFocusScope`) — ni proximité, ni top-N par volume.
 */
export function isFocusCity(city: CityCoverage, scope: FocusScope): boolean {
  return scope.slugs.has(city.citySlug);
}

/**
 * Expression `fill-opacity` MapLibre. Deux régimes (D3) :
 *   - `focusOnly=false` (Province) : opacité uniforme, les 1104 villes visibles.
 *   - `focusOnly=true`  (focus) : surbrillance des villes à signaux PRIORITAIRES
 *     z∩m∩p (`computeFocusScope`), le reste de la province atténué. C'est un
 *     HIGHLIGHT visuel (pas un recompute, pas un filtre de données).
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
 * focus, lui, se base sur les signaux PRIORITAIRES z∩m∩p (computeFocusScope).
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
