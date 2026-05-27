import { z } from "zod";
import { Confidence } from "./opportunity.js";
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

export const RecommendationCap = Action.extract(["surveiller", "qualifier-avec-expert", "monter-dossier-acquisition"]);
export type RecommendationCapT = z.infer<typeof RecommendationCap>;

export const OpportunityScore = z.object({
  axes: z.record(Axis, AxisScore),
  weightsVersion: z.string(),
  partial: z.boolean(),
  tooThin: z.boolean(),
  score: z.number().min(0).max(5).nullable(),
  availableWeightSum: z.number(),
  recommendationCap: RecommendationCap,
});
export type OpportunityScoreT = z.infer<typeof OpportunityScore>;
