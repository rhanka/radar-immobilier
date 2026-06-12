/**
 * Score de potentiel par lot — calcul pur, sans accès DB.
 *
 * ## Échelle : 0 – 10 (distincte des autres échelles du projet)
 *
 * ATTENTION : cette échelle EST DISTINCTE de :
 *   - L'échelle 0-5 des dossiers T2 (scoring par opportunité, 40/40/20 — ne PAS réutiliser).
 *   - L'échelle 0-100 legacy (scoreGlobal — ne PAS réutiliser).
 *
 * ### Formule (bornes documentées)
 *
 * Le score est calculé en deux étapes :
 *
 * **Étape 1 — Score de densité (0–5)**
 *   Basé sur `ZoneVersion.densiteLogHa` (log/ha) — mesure l'intensité constructible.
 *   - null ou 0          → 0.0  (inconnu ou sans densité)
 *   - 0 < d ≤ 20        → 1.0  (très faible, rural)
 *   - 20 < d ≤ 50       → 2.0  (faible densité, banlieue)
 *   - 50 < d ≤ 100      → 3.0  (densité moyenne, suburbain)
 *   - 100 < d ≤ 200     → 4.0  (haute densité)
 *   - d > 200           → 5.0  (très haute densité, hypercentre)
 *
 * **Étape 2 — Bonus / malus**
 *   a) Bonus ZoneKind résidentiel ou mixte : +1.0 si kind ∈ {H, MIXTE}
 *      (zones à vocation principale habitation — le plus pertinent pour le radar)
 *   b) Bonus TOD (transit-oriented development) : +1.0 si inTod === true
 *   c) Malus usage lot incompatible : -1.0 si usageCode ∈ {BO, TE}
 *      (boisé/terrains naturels — constructibilité nulle sans rezonage)
 *   d) Bonus zone commerciale/industrielle/urbaine reconvertible : +0.5 si kind ∈ {C, U, I}
 *      (potentiel de rezonage vers H)
 *
 * Score final = clamp(scoreBase + bonus, 0, 10)
 * Le score est arrondi à 1 décimale.
 *
 * **Pré-filtres** (retournent score = 0 directement si non satisfaits) :
 *   - superficie minimum : si `superficieMinM2` défini et `lot.superficieM2` non-null
 *     et inférieur → score = 0.
 *   - usages exclus : si `excludeUsageCodes` défini et lot.usageCode dedans → score = 0.
 *
 * ### Calculabilité 100 %
 * La fonction accepte des valeurs null sur tous les champs optionnels.
 * Un lot sans aucune info retourne 0.0 (score minimal, non-disponible implicite).
 * Aucune valeur n'est inventée.
 */

// ─── Types (sous-ensemble des champs specs, pas de DB) ────────────────────────

/** Sous-ensemble de ZoneKind (SPEC_DESIGN_DATA_MODEL §1.1). */
export type ZoneKind =
  | "H"
  | "C"
  | "U"
  | "I"
  | "P"
  | "A"
  | "CONS"
  | "REC"
  | "MIXTE"
  | "AUTRE";

/**
 * Projection des champs de ZoneVersion nécessaires au scoring.
 * Source : SPEC_DESIGN_DATA_MODEL §1.1 — ZoneVersion.
 */
export interface ZoneVersionInput {
  /** Densité en logements/hectare. null = non-disponible. */
  densiteLogHa: number | null;
  /** Usages permis (tableau de codes string). */
  usages: string[];
  /** Type de zone. */
  kind: ZoneKind;
}

/** Codes d'usage du lot — SPEC_DESIGN_DATA_MODEL §1.2 LotVersion. */
export type LotUsageCode = "RU" | "CH" | "BO" | "AV" | "TE" | "AUTRE";

/**
 * Projection des champs de LotVersion nécessaires au scoring.
 * Source : SPEC_DESIGN_DATA_MODEL §1.2 — LotVersion.
 */
export interface LotVersionInput {
  /** Superficie du lot en m². null = non-disponible. */
  superficieM2: number | null;
  /** Code d'usage RL0101Ex standardisé QC. null = non-disponible. */
  usageCode: LotUsageCode | null;
}

// ─── Options ──────────────────────────────────────────────────────────────────

export interface LotPotentialFilters {
  /**
   * Superficie minimale en m² pour qu'un lot soit considéré constructible.
   * Si défini et que le lot a une superficie connue inférieure → score = 0.
   * Si undefined ou si superficieM2 est null → pas de filtre appliqué.
   */
  superficieMinM2?: number;
  /**
   * Codes d'usage à exclure du scoring (score = 0 direct).
   * Exemple : ["BO", "TE"] pour exclure boisés et terrains naturels.
   */
  excludeUsageCodes?: LotUsageCode[];
}

export interface LotPotentialOptions {
  /**
   * Le lot est-il dans une zone TOD (transit-oriented development) ?
   * false si inconnu — jamais inventé.
   */
  inTod?: boolean;
  /** Pré-filtres optionnels. */
  filters?: LotPotentialFilters;
}

// ─── Résultat ─────────────────────────────────────────────────────────────────

export interface LotPotentialResult {
  /**
   * Score de potentiel par lot.
   * Échelle 0–10, arrondi à 1 décimale.
   * 0 = aucun potentiel détecté (inconnu ou filtré).
   * 10 = potentiel maximal théorique.
   */
  score: number;
  /**
   * Détail des composantes pour débogage et transparence.
   */
  detail: {
    scoreBase: number;
    bonusKind: number;
    bonusTod: number;
    malusUsage: number;
    bonusReconvertible: number;
    filteredOut: boolean;
    filteredReason?: string;
  };
}

// ─── Constantes de la formule ─────────────────────────────────────────────────

/** ZoneKind résidentiels → bonus +1.0 */
const RESIDENTIAL_KINDS: Set<ZoneKind> = new Set(["H", "MIXTE"]);

/** ZoneKind reconvertibles vers résidentiel → bonus +0.5 */
const RECONVERTIBLE_KINDS: Set<ZoneKind> = new Set(["C", "U", "I"]);

/** LotUsageCode avec constructibilité naturelle nulle → malus -1.0 */
const NON_BUILDABLE_USAGE_CODES: Set<LotUsageCode> = new Set(["BO", "TE"]);

/**
 * Convertit une densité en log/ha vers un score de base 0–5.
 * null ou 0 → 0.0 (non-disponible = potentiel inconnu, score minimal).
 */
function densiteToBaseScore(densiteLogHa: number | null): number {
  if (densiteLogHa === null || densiteLogHa <= 0) return 0.0;
  if (densiteLogHa <= 20) return 1.0;
  if (densiteLogHa <= 50) return 2.0;
  if (densiteLogHa <= 100) return 3.0;
  if (densiteLogHa <= 200) return 4.0;
  return 5.0;
}

// ─── Fonction principale ───────────────────────────────────────────────────────

/**
 * Calcule le score de potentiel par lot.
 *
 * Entrées : champs de LotVersion + ZoneVersion (sous-ensemble minimal).
 * Sortie  : score 0–10 + détail des composantes.
 *
 * @param lot         - Champs LotVersion : superficieM2, usageCode.
 * @param zoneVersion - Champs ZoneVersion : densiteLogHa, usages, kind.
 * @param options     - inTod (bonus TOD) + filtres pré-calcul.
 *
 * @remarks
 * - Aucune valeur n'est inventée (anti-invention).
 * - Calculable pour 100 % des lots (null safe).
 * - Échelle DISTINCTE du 0-5 dossier T2 et du 0-100 legacy.
 * - Ne pas utiliser la formule 40/40/20 ni scoreGlobal.
 */
export function lotPotentialScore(
  lot: LotVersionInput,
  zoneVersion: ZoneVersionInput,
  options: LotPotentialOptions = {},
): LotPotentialResult {
  const { inTod = false, filters = {} } = options;

  // ── Pré-filtres ────────────────────────────────────────────────────────────

  // Filtre superficie minimale (seulement si lot.superficieM2 est connu)
  if (
    filters.superficieMinM2 !== undefined &&
    lot.superficieM2 !== null &&
    lot.superficieM2 < filters.superficieMinM2
  ) {
    return {
      score: 0,
      detail: {
        scoreBase: 0,
        bonusKind: 0,
        bonusTod: 0,
        malusUsage: 0,
        bonusReconvertible: 0,
        filteredOut: true,
        filteredReason: `superficie ${lot.superficieM2} m² < min ${filters.superficieMinM2} m²`,
      },
    };
  }

  // Filtre usage exclu
  if (
    filters.excludeUsageCodes !== undefined &&
    lot.usageCode !== null &&
    filters.excludeUsageCodes.includes(lot.usageCode)
  ) {
    return {
      score: 0,
      detail: {
        scoreBase: 0,
        bonusKind: 0,
        bonusTod: 0,
        malusUsage: 0,
        bonusReconvertible: 0,
        filteredOut: true,
        filteredReason: `usageCode ${lot.usageCode} exclu par filtre`,
      },
    };
  }

  // ── Score de densité (base 0–5) ────────────────────────────────────────────
  const scoreBase = densiteToBaseScore(zoneVersion.densiteLogHa);

  // ── Bonus / malus ──────────────────────────────────────────────────────────

  // a) Bonus kind résidentiel / mixte
  const bonusKind = RESIDENTIAL_KINDS.has(zoneVersion.kind) ? 1.0 : 0.0;

  // b) Bonus TOD
  const bonusTod = inTod ? 1.0 : 0.0;

  // c) Malus usage non-constructible (lot)
  const malusUsage =
    lot.usageCode !== null && NON_BUILDABLE_USAGE_CODES.has(lot.usageCode)
      ? -1.0
      : 0.0;

  // d) Bonus zone reconvertible vers résidentiel
  const bonusReconvertible = RECONVERTIBLE_KINDS.has(zoneVersion.kind) ? 0.5 : 0.0;

  // ── Score final ────────────────────────────────────────────────────────────
  const raw = scoreBase + bonusKind + bonusTod + malusUsage + bonusReconvertible;
  const clamped = Math.max(0, Math.min(10, raw));
  const score = Math.round(clamped * 10) / 10;

  return {
    score,
    detail: {
      scoreBase,
      bonusKind,
      bonusTod,
      malusUsage,
      bonusReconvertible,
      filteredOut: false,
    },
  };
}
