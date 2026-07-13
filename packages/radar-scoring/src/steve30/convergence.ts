/**
 * Steve-30 convergence report.
 *
 * Scores every labelled city with the v0 rule model, then measures how well
 * the score RANKS the cities like Steve's note (§4.5): Spearman ρ, per-city
 * absolute error, and gross inversions between the 8–10/10 band and the
 * 0–3/10 band. Nothing is tuned here — this is the honest measurement.
 */

import { scoreSteve30 } from "./score.js";
import type { SteveScore } from "./score.js";
import { spearman, grossInversions } from "./spearman.js";
import type { GrossInversion } from "./spearman.js";
import { STEVE30_SCORED } from "./dataset.js";
import type { SteveCityLabel } from "./dataset.js";

export interface ScoredCity {
  id: string;
  city: string;
  signalLabel: string | null;
  note: number; // Steve's note (guaranteed present in the scored subset)
  score: number; // radar v0 score in [0, 10]
  absError: number; // |note - score|
  dominantFactors: string[];
  detail: SteveScore;
}

export interface ConvergenceReport {
  /** Primary metric: Spearman rank correlation in [-1, 1]. */
  spearman: number;
  /** Mean absolute error between note and score (secondary, informational). */
  meanAbsError: number;
  /** Per-city scored rows, sorted by descending radar score. */
  scored: ScoredCity[];
  /** Gross inversions (Steve high band vs low band, score fails to separate). */
  grossInversions: GrossInversion[];
  /** Number of labelled rows used. */
  n: number;
}

/** Score one labelled row and pair it with Steve's note. */
export function scoreLabelledCity(row: SteveCityLabel): ScoredCity {
  if (row.note === null) throw new Error(`row ${row.id} has no note`);
  const detail = scoreSteve30(row.features);
  return {
    id: row.id,
    city: row.city,
    signalLabel: row.signalLabel,
    note: row.note,
    score: detail.score,
    absError: Math.abs(row.note - detail.score),
    dominantFactors: detail.dominantFactors,
    detail,
  };
}

/**
 * Run the full convergence measurement over the labelled subset (defaults to
 * STEVE30_SCORED). Pure and deterministic.
 */
export function computeConvergence(
  rows: readonly SteveCityLabel[] = STEVE30_SCORED,
): ConvergenceReport {
  const scored = rows.map(scoreLabelledCity);
  const notes = scored.map((s) => s.note);
  const scores = scored.map((s) => s.score);
  const rho = spearman(notes, scores);
  const meanAbsError =
    scored.reduce((acc, s) => acc + s.absError, 0) / scored.length;
  const inversions = grossInversions(
    scored.map((s) => ({ id: s.id, reference: s.note, candidate: s.score })),
  );
  const sorted = scored.slice().sort((a, b) => b.score - a.score);
  return {
    spearman: rho,
    meanAbsError,
    scored: sorted,
    grossInversions: inversions,
    n: scored.length,
  };
}
