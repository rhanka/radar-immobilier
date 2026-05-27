import { z } from "zod";
import { Confidence } from "./common.js";
import { Mode } from "./common.js";

export const SignalType = z.enum([
  "residential-rezoning", "cptaq", "ppcmoi", "derogation-relevant",
  "political-intention", "public-consultation", "plan-urbanisme",
  "grid-cos-modification", "requalification-tod", "public-investment",
  "derogation-irrelevant",
]);
export type SignalTypeT = z.infer<typeof SignalType>;

export const SignalStatus = z.enum(["nouveau", "à-approfondir", "écarté", "surveillance"]);
export type SignalStatusT = z.infer<typeof SignalStatus>;

/** Default /10 triage prior per type (VISION §6). value + confidence are NEVER multiplied. */
export const SIGNAL_TYPE_VALUES: Record<SignalTypeT, number> = {
  "residential-rezoning": 10, "cptaq": 8, "ppcmoi": 7, "derogation-relevant": 5,
  "political-intention": 6, "public-consultation": 6, "plan-urbanisme": 7,
  "grid-cos-modification": 6, "requalification-tod": 7, "public-investment": 5,
  "derogation-irrelevant": 1,
};

export const Signal = z.object({
  id: z.string().min(1),
  type: SignalType,
  value: z.number().min(0).max(10),
  confidence: Confidence,
  status: SignalStatus,
  sourceRefs: z.array(z.string()).default([]),
  detectedAt: z.string().min(4),
  bylaw: z.string().optional(),
  zone: z.string().optional(),
  mode: Mode.default("real"),
});
export type SignalT = z.infer<typeof Signal>;
