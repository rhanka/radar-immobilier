import { Axis } from "@radar/domain";
import type { AxisT, AxisScoreT, RecommendationCapT } from "@radar/domain";

const AXES = Axis.options;
const WEIGHT_FLOOR = 0.50;

export interface AggregateResult {
  score: number | null;
  partial: boolean;
  availableWeightSum: number;
  /** true only when partial is also true (a too-thin dossier is always partial) */
  tooThin: boolean;
  recommendationCap: RecommendationCapT;
}

export function aggregate(
  axes: Record<AxisT, AxisScoreT>,
  weights: Record<AxisT, number>,
): AggregateResult {
  // reject unknown axis keys
  for (const k of Object.keys(axes)) {
    if (!(AXES as readonly string[]).includes(k)) throw new Error(`unknown axis ${k}`);
  }
  // validate each required axis
  for (const k of AXES) {
    const a = axes[k];
    const w = weights[k];
    if (!a) throw new Error(`missing axis ${k}`);
    if (!Number.isFinite(w) || w < 0) throw new Error(`bad weight ${k}`);
    const available = a.availability === "available";
    if (available !== (a.level !== null))
      throw new Error(`axis ${k}: availability/level mismatch`);
    if (available && !(Number.isFinite(a.level!) && a.level! >= 0 && a.level! <= 5))
      throw new Error(`axis ${k}: level out of [0,5]`);
  }
  // aggregate
  const avail = AXES.filter((k) => axes[k].availability === "available");
  const wSum = avail.reduce((s, k) => s + weights[k], 0);
  const partial = avail.length < AXES.length;
  if (wSum < WEIGHT_FLOOR) {
    return { score: null, partial, availableWeightSum: wSum, tooThin: true, recommendationCap: "surveiller" };
  }
  const score = avail.reduce((s, k) => s + (axes[k].level! * weights[k]) / wSum, 0);
  const cap = partial ? "qualifier-avec-expert" : "monter-dossier-acquisition";
  return { score, partial, availableWeightSum: wSum, tooThin: false, recommendationCap: cap };
}
