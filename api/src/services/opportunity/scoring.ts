/**
 * Opportunity scoring service — v1.
 *
 * scoreOpportunity(citySlug, event) → score 0–100 derived exclusively from
 * REAL observable signals. No fabricated data, no market proxies.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FORMULA v1 — three factors, transparent weights, score = Σ(factor × weight)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. PROXIMITE (weight 0.40)
 *    Source: distanceToMtlKm from @radar/sources municipalities data.
 *    Rationale: closer to Montréal → higher demand pressure → better opportunity.
 *    Scoring (raw 0–1 → weighted):
 *      distance ≤ 15 km  → 1.00
 *      distance ≤ 25 km  → 0.80
 *      distance ≤ 35 km  → 0.60
 *      distance ≤ 50 km  → 0.40
 *      distance > 50 km  → 0.20
 *    Unknown city (slug not in municipalities) → 0.20 (conservative).
 *
 * 2. ZONE_TYPE (weight 0.40)
 *    Source: zoneRefs extracted from the DesignationEvent canonical by
 *            signals-detail (real PV parser output, no fabrication).
 *    Rationale: H-/RM-/MxtV- zone prefixes signal residential/mixed-use
 *               densification intent in Quebec municipal zoning practice.
 *    Scoring:
 *      ≥1 zone ref matching residential/mixed prefix → 1.00
 *      ≥1 zone ref present but none residential/mixed → 0.40
 *      no zone refs at all → 0.20
 *    Residential/mixed prefixes (case-insensitive): H, RM, MXTV, R.
 *    These are the four families documented in the PV datasets:
 *      H-NNN  (habitation, e.g. H-431 Saint-Constant)
 *      RM-NNN (résidentiel mixte)
 *      MxtV-N (mixte-villageois, Châteauguay)
 *      C-NNN  is commercial — NOT residential → 0.40
 *
 * 3. RECENCE (weight 0.20)
 *    Source: dateObserved = project-state generatedAt (ISO timestamp).
 *    Rationale: fresher signals have higher actionability.
 *    Scoring (calendar days since dateObserved):
 *      ≤ 30 days  → 1.00
 *      ≤ 90 days  → 0.80
 *      ≤ 180 days → 0.60
 *      ≤ 365 days → 0.40
 *      > 365 days → 0.20
 *    Invalid/missing date → 0.20 (conservative).
 *
 * TOTAL SCORE = round( (proximite × 0.40 + zoneType × 0.40 + recence × 0.20) × 100 )
 *
 * Notes:
 *  - Scale: 0–100 (integer after rounding).
 *  - All inputs come from persisted real data; nothing is inferred or invented.
 *  - Weights are explicit constants exported alongside the score.
 *  - "Honest" anti-invention policy: a missing signal (unknown city, no zone
 *    refs) always yields the LOWEST bracket for that factor, not zero.
 *    This avoids false negatives on under-processed cities.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { QC_MUNICIPALITIES } from "@radar/sources/municipalities";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** A single DesignationEvent detail from the ontology project state. */
export interface ScoredEventInput {
  /** Label verbatim from source bytes. */
  label: string;
  /** Règlement numbers extracted by the PV parser. */
  reglementNumbers: string[];
  /** Zone codes extracted by the PV parser. */
  zoneRefs: string[];
  /** Raw S3 evidence ref. */
  sourceRef: string;
  /** ISO date string — generatedAt of the project state. */
  dateObserved: string;
}

/** Decomposed scoring factors for a single opportunity. */
export interface OpportunityFactors {
  /** 0–1 proximity sub-score (based on distanceToMtlKm). */
  proximite: number;
  /** 0–1 zone type sub-score (residential/mixed-use signal in zoneRefs). */
  zoneType: number;
  /** 0–1 recency sub-score (based on dateObserved age). */
  recence: number;
}

/** Full scored opportunity record. */
export interface ScoredOpportunity {
  citySlug: string;
  reglementNumbers: string[];
  zoneRefs: string[];
  label: string;
  sourceRef: string;
  dateObserved: string;
  /** Final 0–100 integer score. */
  score: number;
  /** Decomposed factors (each 0–1). */
  facteurs: OpportunityFactors;
}

// ─────────────────────────────────────────────────────────────────────────────
// Weights (explicit, exported for tests and documentation)
// ─────────────────────────────────────────────────────────────────────────────

export const SCORE_WEIGHTS: Readonly<{ proximite: number; zoneType: number; recence: number }> = {
  proximite: 0.40,
  zoneType: 0.40,
  recence: 0.20,
};

// ─────────────────────────────────────────────────────────────────────────────
// Municipality distance lookup
// ─────────────────────────────────────────────────────────────────────────────

/** Build a slug→distanceToMtlKm lookup from the municipalities dataset. */
const DISTANCE_BY_SLUG: ReadonlyMap<string, number> = new Map(
  QC_MUNICIPALITIES.map((m) => [m.slug, m.distanceToMtlKm]),
);

// ─────────────────────────────────────────────────────────────────────────────
// Factor scorers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Proximity factor (0–1) based on distance to Montréal.
 * Unknown slug → 0.20 (conservative — city may simply be missing from the
 * municipality dataset; do not penalize with 0).
 */
export function scoreProximite(citySlug: string): number {
  const distKm = DISTANCE_BY_SLUG.get(citySlug);
  if (distKm === undefined) return 0.20;
  if (distKm <= 15) return 1.00;
  if (distKm <= 25) return 0.80;
  if (distKm <= 35) return 0.60;
  if (distKm <= 50) return 0.40;
  return 0.20;
}

/**
 * Residential/mixed-use zone prefix regex.
 * Matches: H-, RM-, MXTV-, R- (and lowercase variants).
 * Not matched: C- (commercial), I- (industriel), A- (agricole), etc.
 */
const RESIDENTIAL_MIXED_ZONE_RE = /^(H|RM|MXTV|R)-/i;

/**
 * Zone type factor (0–1) based on zoneRefs content.
 * 1.00 → at least one residential/mixed zone code
 * 0.40 → zone refs present but none residential/mixed
 * 0.20 → no zone refs (signal is real but zone not identified)
 */
export function scoreZoneType(zoneRefs: string[]): number {
  if (zoneRefs.length === 0) return 0.20;
  const hasResidential = zoneRefs.some((z) => RESIDENTIAL_MIXED_ZONE_RE.test(z));
  return hasResidential ? 1.00 : 0.40;
}

/**
 * Recency factor (0–1) based on age of the dateObserved timestamp.
 * Invalid/empty date → 0.20 (conservative).
 */
export function scoreRecence(dateObserved: string, nowMs: number = Date.now()): number {
  if (!dateObserved) return 0.20;
  const ts = Date.parse(dateObserved);
  if (!Number.isFinite(ts)) return 0.20;
  const ageDays = (nowMs - ts) / (1000 * 60 * 60 * 24);
  if (ageDays <= 30) return 1.00;
  if (ageDays <= 90) return 0.80;
  if (ageDays <= 180) return 0.60;
  if (ageDays <= 365) return 0.40;
  return 0.20;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main scorer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Score a single DesignationEvent opportunity.
 *
 * All factor values are deterministic functions of real data only:
 *   - proximite: from QC_MUNICIPALITIES distanceToMtlKm
 *   - zoneType:  from event.zoneRefs (PV parser output)
 *   - recence:   from event.dateObserved (project-state generatedAt)
 *
 * Score = round( Σ(factor × weight) × 100 ) ∈ [0, 100].
 */
export function scoreOpportunity(
  citySlug: string,
  event: ScoredEventInput,
  nowMs: number = Date.now(),
): ScoredOpportunity {
  const proximite = scoreProximite(citySlug);
  const zoneType = scoreZoneType(event.zoneRefs);
  const recence = scoreRecence(event.dateObserved, nowMs);

  const rawScore =
    proximite * SCORE_WEIGHTS.proximite +
    zoneType * SCORE_WEIGHTS.zoneType +
    recence * SCORE_WEIGHTS.recence;

  const score = Math.round(rawScore * 100);

  return {
    citySlug,
    reglementNumbers: event.reglementNumbers,
    zoneRefs: event.zoneRefs,
    label: event.label,
    sourceRef: event.sourceRef,
    dateObserved: event.dateObserved,
    score,
    facteurs: { proximite, zoneType, recence },
  };
}
