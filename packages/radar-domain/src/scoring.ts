/**
 * Scoring model (PROCESS.md §3). Weights MUST sum to 100. Each criterion
 * is scored 0–5 with attached evidence; the aggregate is the
 * weighted sum normalized to 0–100 (rules/scoring.md).
 */
export const SCORING_CRITERIA = [
  { key: "regulatory_potential", weight: 30 },
  { key: "constraint_risk", weight: 20 },
  { key: "timing", weight: 20 },
  { key: "land_feasibility", weight: 15 },
  { key: "market_value", weight: 15 },
] as const;

export type ScoringCriterionKey = (typeof SCORING_CRITERIA)[number]["key"];

/** Per-criterion raw score range. */
export const CRITERION_MIN = 0;
export const CRITERION_MAX = 5;

/** Sum of weights — must always equal 100. */
export const TOTAL_WEIGHT = SCORING_CRITERIA.reduce(
  (sum, c) => sum + c.weight,
  0,
);

/**
 * Aggregate a set of per-criterion raw scores (0–5) into a normalized
 * radar score (0–100). Missing criteria count as 0.
 */
export function aggregateRadarScore(
  rawScores: Partial<Record<ScoringCriterionKey, number>>,
): number {
  const weighted = SCORING_CRITERIA.reduce((sum, c) => {
    const raw = rawScores[c.key] ?? 0;
    const clamped = Math.min(Math.max(raw, CRITERION_MIN), CRITERION_MAX);
    return sum + (clamped / CRITERION_MAX) * c.weight;
  }, 0);
  // weighted is already on a 0–100 scale because weights sum to 100.
  return Math.round(weighted * 100) / 100;
}
