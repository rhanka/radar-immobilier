import { z } from "zod";
import { Confidence } from "./common.js";
import { Action } from "./journal.js";

export const Axis = z.enum(["potentiel", "risque", "timing", "faisabilite", "marche"]);
export type AxisT = z.infer<typeof Axis>;
export const Availability = z.enum(["available", "non-disponible"]);
export type AvailabilityT = z.infer<typeof Availability>;

export const AxisScore = z.object({
  level: z.number().min(0).max(5).nullable(),
  availability: Availability,
  confidence: Confidence,
  evidenceRefs: z.array(z.string()).default([]),
  rationale: z.string(),
  gridVersion: z.string(),
}).refine(
  (a) => (a.availability === "available") === (a.level !== null),
  { message: "invariant: available ⇔ level !== null" },
);
export type AxisScoreT = z.infer<typeof AxisScore>;

export const AxesMap = z.object({
  potentiel: AxisScore,
  risque: AxisScore,
  timing: AxisScore,
  faisabilite: AxisScore,
  marche: AxisScore,
});
export type AxesMapT = z.infer<typeof AxesMap>;

export const RecommendationCap = Action.extract(["surveiller", "qualifier-avec-expert", "monter-dossier-acquisition"]);
export type RecommendationCapT = z.infer<typeof RecommendationCap>;

const axesBase = z.partialRecord(Axis, AxisScore);

const axesGuarded = z.preprocess((raw, ctx) => {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const allowed = new Set<string>(Axis.options);
    const foreign = Object.keys(raw).filter((key) => !allowed.has(key));
    if (foreign.length) {
      ctx.addIssue({ code: "unrecognized_keys", keys: foreign });
      return z.NEVER;
    }
  }
  return raw;
}, axesBase);

export const OpportunityScore = z.object({
  axes: axesGuarded,
  weightsVersion: z.string(),
  partial: z.boolean(),
  tooThin: z.boolean(),
  score: z.number().min(0).max(5).nullable(),
  availableWeightSum: z.number(),
  recommendationCap: RecommendationCap,
});
export type OpportunityScoreT = z.infer<typeof OpportunityScore>;
