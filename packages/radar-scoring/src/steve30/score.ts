/**
 * Steve-30 convergence — the v0 explicable score.
 *
 * A transparent weighted rule function: score = sum of named positive
 * contributions minus named penalties, hard-gated by residential relevance,
 * clamped to [0, 10]. Every term is traceable to a named weight in
 * features.ts and to a sourced feature value. Deterministic and pure.
 */

import {
  NATURE_POINTS,
  EARLINESS_POINTS,
  REG_EXPLOIT_POINTS,
  LAND_EXPLOIT_POINTS,
  PRECEDENT_POINTS,
  DISTANCE_POINTS,
  OWNER_PENALTY,
  SCALE_PENALTY,
  CORE_FEATURES,
  UNCERTAINTY_PER_MISSING,
  SCORE_MIN,
  SCORE_MAX,
  STEVE30_SCORE_VERSION,
} from "./features.js";
import type { SteveFeatures } from "./features.js";

/** One named line of the score build-up. */
export interface ScoreTerm {
  /** Named component (e.g. "nature", "ownerPenalty"). */
  component: string;
  /** The feature value that produced it (verbatim enum or null). */
  value: string | number | boolean | null;
  /** Signed points contributed (positive contribution or negative penalty). */
  points: number;
}

export interface SteveScore {
  version: string;
  /** Final score in [0, 10], comparable to Steve's note. */
  score: number;
  /** True when the residential gate forced the score to 0 (noise). */
  gatedNonResidential: boolean;
  /** Named build-up, in order, summing (pre-clamp) to `rawScore`. */
  terms: ScoreTerm[];
  /** Sum of terms before clamping to [0, 10]. */
  rawScore: number;
  /** Core features that were null and triggered the uncertainty penalty. */
  missingCoreFeatures: string[];
  /** The 3–5 dominant (largest-magnitude) named factors, for explanation. */
  dominantFactors: string[];
}

const clamp = (x: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, x));

/**
 * Score one signal from its measurable features.
 *
 * Residential-relevance gate: a `non_residential` signal is Steve's "bruit"
 * (camping/industrial/commercial/environmental) and scores 0 regardless of
 * the rest — this mirrors his 0/10 verdicts (Stratford, Mont-Saint-Hilaire S1
 * is instead handled via project scale). The gate is applied FIRST so the
 * explanation is unambiguous.
 */
export function scoreSteve30(features: SteveFeatures): SteveScore {
  const terms: ScoreTerm[] = [];

  // Hard gate: non-residential is noise → 0, with an explicit single term.
  if (features.residentialRelevance === "non_residential") {
    return {
      version: STEVE30_SCORE_VERSION,
      score: 0,
      gatedNonResidential: true,
      terms: [
        {
          component: "residentialGate",
          value: "non_residential",
          points: 0,
        },
      ],
      rawScore: 0,
      missingCoreFeatures: [],
      dominantFactors: ["residentialGate"],
    };
  }

  // Positive contributions.
  const nature = features.changeNature;
  terms.push({
    component: "nature",
    value: nature,
    points: nature ? NATURE_POINTS[nature] : 0,
  });

  const earliness = features.earliness;
  terms.push({
    component: "earliness",
    value: earliness,
    points: earliness ? EARLINESS_POINTS[earliness] : 0,
  });

  const reg = features.regulatoryExploitability;
  terms.push({
    component: "regulatoryExploitability",
    value: reg,
    points: reg ? REG_EXPLOIT_POINTS[reg] : 0,
  });

  const land = features.landExploitability;
  terms.push({
    component: "landExploitability",
    value: land,
    points: land ? LAND_EXPLOIT_POINTS[land] : 0,
  });

  terms.push({
    component: "zonePrecedent",
    value: features.zonePrecedent,
    points: features.zonePrecedent === true ? PRECEDENT_POINTS : 0,
  });

  const distance = features.distanceMtl;
  terms.push({
    component: "distanceMtl",
    value: distance,
    points: distance ? DISTANCE_POINTS[distance] : 0,
  });

  // Penalties (≤ 0).
  const owner = features.ownerType;
  terms.push({
    component: "ownerPenalty",
    value: owner,
    points: owner ? OWNER_PENALTY[owner] : 0,
  });

  const scale = features.projectScale;
  terms.push({
    component: "scalePenalty",
    value: scale,
    points: scale ? SCALE_PENALTY[scale] : 0,
  });

  // Uncertainty penalty: one per missing CORE feature.
  const missingCoreFeatures = CORE_FEATURES.filter(
    (f) => features[f] === null,
  ) as string[];
  terms.push({
    component: "uncertaintyPenalty",
    value: missingCoreFeatures.length,
    points: missingCoreFeatures.length * UNCERTAINTY_PER_MISSING,
  });

  const rawScore = terms.reduce((s, t) => s + t.points, 0);
  const score = clamp(rawScore, SCORE_MIN, SCORE_MAX);

  // Dominant factors: the 3–5 largest-magnitude named terms (non-zero).
  const dominantFactors = terms
    .filter((t) => t.points !== 0)
    .slice()
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    .slice(0, 5)
    .map((t) => t.component);

  return {
    version: STEVE30_SCORE_VERSION,
    score,
    gatedNonResidential: false,
    terms,
    rawScore,
    missingCoreFeatures,
    dominantFactors,
  };
}
