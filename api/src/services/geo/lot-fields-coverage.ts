/**
 * lot-fields-coverage — mesure de la couverture des champs LOT enrichis servis
 * par geo sur `qc-lots-<slug>` : superficie réelle (`surface_m2`), adresse
 * (`adresse`), code postal FSA (`code_postal`) et normes de zonage foldées au
 * lot (`hauteur_max_value`, `densite_value`, `frontage_min_value`,
 * `superficie_min_value`, `marge_{avant,laterale,arriere}_min_value`).
 *
 * MÉTHODE (honnête, déclarée dans la réponse) :
 *   - le total de lots servis vient de `numberMatched` (exact, côté geo) ;
 *   - ≤ {@link LOT_FIELDS_MAX_SAMPLE} lots → TOUS les lots sont mesurés
 *     (`sampled: false`, les % sont exacts) ;
 *   - au-delà → ÉCHANTILLON STRATIFIÉ de 3 tranches de
 *     {@link LOT_FIELDS_CHUNK} lots (début / milieu / fin via `offset`,
 *     `sampled: true`, les % sont estimés sur l'échantillon). L'API geo ne
 *     supporte NI filtre CQL NI sélection de propriétés (vérifié live
 *     2026-07-05 : filtres ignorés silencieusement) — le comptage exact
 *     par champ n'est pas possible côté serveur.
 *
 * verbatim-or-null : un champ n'est compté PRÉSENT que si geo sert une valeur
 * réelle (nombre fini / chaîne non vide). Jamais de valeur inventée, jamais de
 * « 100 % » affichable quand l'échantillon est partiel ({@link honestPct}).
 *
 * Service PUR (fetch injecté, aucune dépendance repo) : réutilisé tel quel par
 * la route /api/source/coverage (endpoint lazy per-city) ET par le script de
 * validation exhaustive `scripts/validate-lot-fields-coverage.ts` — la mesure
 * UI et la mesure de validation sont LA MÊME.
 */

export type LotFieldsCoverageState = "verified" | "declared" | "absent";

/** Tranche d'échantillon (lots par requête items). */
export const LOT_FIELDS_CHUNK = 150;
/** Au-delà de ce total, on échantillonne (3 × {@link LOT_FIELDS_CHUNK}). */
export const LOT_FIELDS_MAX_SAMPLE = 450;

/** Normes foldées au lot par geo — présence = au moins UNE valeur non nulle. */
export const LOT_NORM_VALUE_KEYS = [
  "hauteur_max_value",
  "densite_value",
  "frontage_min_value",
  "superficie_min_value",
  "marge_avant_min_value",
  "marge_laterale_min_value",
  "marge_arriere_min_value",
] as const;

/** Comptes bruts de présence par champ sur les lots mesurés. */
export interface LotFieldCounts {
  /** `surface_m2` : aire réelle du lot (nombre fini > 0). */
  superficie: number;
  /** `adresse` : chaîne non vide. */
  adresse: number;
  /** `code_postal` : chaîne non vide (FSA). */
  codePostal: number;
  /** ≥ 1 des {@link LOT_NORM_VALUE_KEYS} non nul. */
  normes: number;
}

/** Taux d'un champ : compte, % honnête, tri-état. */
export interface LotFieldRate {
  count: number;
  /**
   * % entier HONNÊTE sur l'échantillon : borné à [1, 99] quand la couverture
   * est partielle (jamais un « 100 % » arrondi, jamais un « 0 % » masquant des
   * lots réellement couverts).
   */
  pct: number;
  /**
   * Tri-état : `verified` = présent sur TOUT l'échantillon, `declared` =
   * présent sur une partie, `absent` = présent nulle part.
   */
  state: LotFieldsCoverageState;
}

/**
 * Réponse du détail « champs lot » d'une ville (endpoint lazy + validation).
 * `available: false` = geo injoignable (dégradé honnête, PAS un « 0 % »).
 */
export interface CityLotFieldsResponse {
  citySlug: string;
  available: boolean;
  /** Lots servis au total (`numberMatched`) ; null si geo ne le publie pas. */
  totalLots?: number | null;
  /** Lots effectivement mesurés. */
  sampleSize?: number;
  /** true = mesure sur échantillon (les % sont estimés, pas exacts). */
  sampled?: boolean;
  fields?: {
    superficie: LotFieldRate;
    adresse: LotFieldRate;
    codePostal: LotFieldRate;
    normes: LotFieldRate;
  };
  /**
   * Tri-état agrégé : `verified` = les 4 champs présents sur TOUT
   * l'échantillon, `declared` = au moins un champ présent quelque part,
   * `absent` = aucun champ présent nulle part (ville non enrichie).
   */
  state?: LotFieldsCoverageState;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fonctions pures (unit-testées)
// ─────────────────────────────────────────────────────────────────────────────

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Une valeur de norme est « portée » si geo sert un nombre fini ou un texte. */
function hasNormValue(value: unknown): boolean {
  return isFiniteNumber(value) || isNonEmptyString(value);
}

/** Compte la présence des 4 champs sur des features geo (verbatim-or-null). */
export function countLotFields(features: readonly unknown[]): LotFieldCounts {
  const counts: LotFieldCounts = {
    superficie: 0,
    adresse: 0,
    codePostal: 0,
    normes: 0,
  };
  for (const feature of features) {
    const rawProps =
      typeof feature === "object" && feature !== null
        ? (feature as { properties?: unknown }).properties
        : null;
    const props =
      typeof rawProps === "object" && rawProps !== null
        ? (rawProps as Record<string, unknown>)
        : {};
    if (isFiniteNumber(props["surface_m2"]) && props["surface_m2"] > 0) {
      counts.superficie += 1;
    }
    if (isNonEmptyString(props["adresse"])) counts.adresse += 1;
    if (isNonEmptyString(props["code_postal"])) counts.codePostal += 1;
    if (LOT_NORM_VALUE_KEYS.some((key) => hasNormValue(props[key]))) {
      counts.normes += 1;
    }
  }
  return counts;
}

/**
 * % entier HONNÊTE : 0 seulement si count=0, 100 seulement si count=sample ;
 * toute couverture partielle est bornée à [1, 99] (l'arrondi ne fabrique
 * jamais un « 100 % » ni n'efface des lots couverts en « 0 % »).
 */
export function honestPct(count: number, sampleSize: number): number {
  if (sampleSize <= 0 || count <= 0) return 0;
  if (count >= sampleSize) return 100;
  const rounded = Math.round((count / sampleSize) * 100);
  return Math.min(99, Math.max(1, rounded));
}

/** Tri-état d'un champ sur l'échantillon. */
export function lotFieldState(
  count: number,
  sampleSize: number,
): LotFieldsCoverageState {
  if (sampleSize <= 0 || count <= 0) return "absent";
  return count >= sampleSize ? "verified" : "declared";
}

function buildRate(count: number, sampleSize: number): LotFieldRate {
  return {
    count,
    pct: honestPct(count, sampleSize),
    state: lotFieldState(count, sampleSize),
  };
}

/**
 * Plan d'échantillonnage : liste de tranches `{ offset, limit }`.
 *   - total ≤ maxSample → tout est lu (mesure EXACTE) ;
 *   - sinon → 3 tranches stratifiées début / milieu / fin (disjointes dès que
 *     total ≥ maxSample, prouvé par construction : mid ≥ chunk et
 *     mid + chunk ≤ total − chunk).
 */
export function buildSamplePlan(
  total: number,
  chunk: number = LOT_FIELDS_CHUNK,
  maxSample: number = LOT_FIELDS_MAX_SAMPLE,
): { offset: number; limit: number }[] {
  if (total <= 0) return [];
  if (total <= maxSample) {
    const plan: { offset: number; limit: number }[] = [];
    for (let offset = 0; offset < total; offset += chunk) {
      plan.push({ offset, limit: Math.min(chunk, total - offset) });
    }
    return plan;
  }
  const mid = Math.floor((total - chunk) / 2);
  return [
    { offset: 0, limit: chunk },
    { offset: mid, limit: chunk },
    { offset: total - chunk, limit: chunk },
  ];
}

/** Agrège comptes + taille d'échantillon en réponse finale (pure). */
export function buildLotFieldsResponse(
  citySlug: string,
  totalLots: number | null,
  sampleSize: number,
  counts: LotFieldCounts,
): CityLotFieldsResponse {
  const fields = {
    superficie: buildRate(counts.superficie, sampleSize),
    adresse: buildRate(counts.adresse, sampleSize),
    codePostal: buildRate(counts.codePostal, sampleSize),
    normes: buildRate(counts.normes, sampleSize),
  };
  const states = [
    fields.superficie.state,
    fields.adresse.state,
    fields.codePostal.state,
    fields.normes.state,
  ];
  const state: LotFieldsCoverageState = states.every((s) => s === "verified")
    ? "verified"
    : states.some((s) => s !== "absent")
      ? "declared"
      : "absent";
  return {
    citySlug,
    available: true,
    totalLots,
    sampleSize,
    sampled: totalLots !== null ? sampleSize < totalLots : sampleSize > 0,
    fields,
    state,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mesure live (fetch injecté)
// ─────────────────────────────────────────────────────────────────────────────

interface ItemsPage {
  features: unknown[];
  numberMatched: number | null;
}

async function fetchItemsPage(
  fetchImpl: typeof fetch,
  baseUrl: string,
  collectionId: string,
  offset: number,
  limit: number,
): Promise<ItemsPage | "not-found" | null> {
  const url =
    `${baseUrl}/collections/${encodeURIComponent(collectionId)}/items` +
    `?limit=${limit}&offset=${offset}&f=json`;
  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch {
    return null;
  }
  if (res.status === 404) return "not-found";
  if (!res.ok) return null;
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return null;
  }
  const features = Array.isArray((body as { features?: unknown }).features)
    ? (body as { features: unknown[] }).features
    : [];
  const matched = (body as { numberMatched?: unknown }).numberMatched;
  return {
    features,
    numberMatched: isFiniteNumber(matched) ? matched : null,
  };
}

/**
 * Mesure la couverture des champs lot d'UNE ville sur la collection live
 * `qc-lots-<slug>`. Retourne :
 *   - `null`               → geo injoignable (l'appelant dégrade honnêtement) ;
 *   - `available` + zéros  → collection absente (404 : aucun lot servi) ;
 *   - la mesure sinon (exacte ≤ {@link LOT_FIELDS_MAX_SAMPLE} lots, sinon
 *     échantillon stratifié déclaré `sampled: true`).
 */
export async function measureCityLotFields(
  citySlug: string,
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CityLotFieldsResponse | null> {
  const collectionId = `qc-lots-${citySlug}`;
  const first = await fetchItemsPage(
    fetchImpl,
    baseUrl,
    collectionId,
    0,
    LOT_FIELDS_CHUNK,
  );
  if (first === null) return null;
  if (first === "not-found") {
    return {
      citySlug,
      available: true,
      totalLots: 0,
      sampleSize: 0,
      sampled: false,
      fields: {
        superficie: buildRate(0, 0),
        adresse: buildRate(0, 0),
        codePostal: buildRate(0, 0),
        normes: buildRate(0, 0),
      },
      state: "absent",
    };
  }

  const total = first.numberMatched;
  let features = first.features;

  if (total !== null && total > first.features.length) {
    // Tranches restantes du plan (la 1re — offset 0 — est déjà lue).
    const plan = buildSamplePlan(total).filter((c) => c.offset > 0);
    const pages = await Promise.all(
      plan.map((c) =>
        fetchItemsPage(fetchImpl, baseUrl, collectionId, c.offset, c.limit),
      ),
    );
    for (const page of pages) {
      // Tranche en échec → on mesure sur ce qu'on a réellement lu (honnête :
      // sampleSize reflète les lots RÉELLEMENT mesurés, jamais extrapolé).
      if (page === null || page === "not-found") continue;
      features = features.concat(page.features);
    }
  }

  return buildLotFieldsResponse(
    citySlug,
    total,
    features.length,
    countLotFields(features),
  );
}
