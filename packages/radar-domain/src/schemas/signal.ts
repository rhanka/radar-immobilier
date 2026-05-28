import { z } from "zod";
import { Confidence } from "./common.js";
import { Mode } from "./common.js";

// S1.3: types retenus = catégories VISION §6 + §4.1 (consultation/plan/grille).
// Retirés : political-intention, requalification-tod, public-investment (trop interprétatifs V1).
// S1.2: dérogation-relevant/irrelevant conservés dans l'enum (données démo) mais non scorés —
//   les dérogations sont un FILTRE pur (VISION) ; leur valeur /10 n'est pas utilisée pour le tri.
export const SignalType = z.enum([
  "residential-rezoning", "cptaq", "ppcmoi",
  "public-consultation", "plan-urbanisme", "grid-cos-modification",
  // dérogations : filtre pur (VISION S1.2) — conservés pour rétrocompatibilité données démo
  "derogation-relevant", "derogation-irrelevant",
]);
export type SignalTypeT = z.infer<typeof SignalType>;

export const SignalStatus = z.enum(["nouveau", "à-approfondir", "écarté", "surveillance"]);
export type SignalStatusT = z.infer<typeof SignalStatus>;

/**
 * Default /10 triage prior per type (VISION §6). value + confidence are NEVER multiplied.
 * S1.2: dérogation-relevant/irrelevant ne sont PAS scorés par ce barème (filtre pur VISION) ;
 *   la valeur 0 signale l'absence de score — utilisez le champ `value` du signal directement.
 * S1.3: political-intention, requalification-tod, public-investment retirés (hors VISION V1).
 */
export const SIGNAL_TYPE_VALUES: Record<SignalTypeT, number> = {
  "residential-rezoning": 10,
  "cptaq": 8,
  "ppcmoi": 7,
  "public-consultation": 6,
  "plan-urbanisme": 7,
  "grid-cos-modification": 6,
  // S1.2 — dérogations : filtre pur, pas de pseudo-score. Valeur 0 = non classifié.
  "derogation-relevant": 0,
  "derogation-irrelevant": 0,
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
