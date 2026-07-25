import { z } from "zod";
import {
  vivierEtapeSchema,
  vivierExclusionReasonSchema,
  vivierV2Schema,
  type VivierEtape,
  type VivierExclusionReason,
  type VivierV2,
} from "./vivier-v2.js";

const countSchema = z.number().int().nonnegative();

export const vivierExcludedByReasonSchema = z.object({
  non_residentiel_franc: countSchema,
  piia_non_pertinent: countSchema,
  hors_zonage: countSchema,
  derogation_hors_sujet: countSchema,
});

export const vivierStageCountsSchema = z.object({
  avis_motion: countSchema,
  projet_reglement: countSchema,
  consultation_publique: countSchema,
  second_projet: countSchema,
  adoption: countSchema,
  entree_vigueur: countSchema,
  inconnu: countSchema,
});

export const vivierCountsSchema = z
  .object({
    qualified: countSchema,
    residentialUnknown: countSchema,
    excludedByReason: vivierExcludedByReasonSchema,
    // B-stage perimeter: records not excluded by the server with zonage `oui`.
    // Combines residential `oui` and `indetermine` (used when `r` is unchecked).
    stageCounts: vivierStageCountsSchema,
    // The same records outside zonage `oui`, bucketed by stage. When `z` is
    // unchecked, rail and panel both combine this with stageCounts.
    stageCountsHorsZonage: vivierStageCountsSchema,
    // Residential-ELIGIBLE subset of stageCounts, used when the `r` axis is
    // checked: zonage `oui`, no exclusion, and residential `oui` OR a complete
    // rezoning/reform whose residential nature is simply not stated. A rezoning
    // reshapes the zoning grid, so it CAN be residential — that is not the same
    // epistemic state as "the minutes do not say" (R2: a reform ranks, it never
    // gates). Only an explicit non-residential is filtered out here.
    stageCountsResEligible: vivierStageCountsSchema,
    // The same eligible records outside zonage `oui`. Combines with
    // stageCountsResEligible when both `z` unchecked and `r` checked.
    stageCountsResEligibleHorsZonage: vivierStageCountsSchema,
    total: countSchema,
  })
  .superRefine((counts, context) => {
    const excluded = Object.values(counts.excludedByReason).reduce(
      (sum, value) => sum + value,
      0,
    );
    if (counts.total !== counts.qualified + counts.residentialUnknown + excluded) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["total"],
        message: "total must equal qualified + residentialUnknown + excludedByReason",
      });
    }
  });

export type VivierCounts = z.infer<typeof vivierCountsSchema>;
export type VivierV2Counts = VivierCounts;

export const VivierCountsSchema = vivierCountsSchema;

function emptyExcludedByReason(): Record<VivierExclusionReason, number> {
  return {
    non_residentiel_franc: 0,
    piia_non_pertinent: 0,
    hors_zonage: 0,
    derogation_hors_sujet: 0,
  };
}

function emptyStageCounts(): Record<VivierEtape, number> {
  return {
    avis_motion: 0,
    projet_reglement: 0,
    consultation_publique: 0,
    second_projet: 0,
    adoption: 0,
    entree_vigueur: 0,
    inconnu: 0,
  };
}

export function countsInvariant(counts: VivierCounts): boolean {
  const excluded = Object.values(counts.excludedByReason).reduce(
    (sum, value) => sum + value,
    0,
  );
  return counts.total === counts.qualified + counts.residentialUnknown + excluded;
}

export const isVivierCountsInvariant = countsInvariant;

/**
 * Instruments whose residential nature is UNSTATED rather than unknown.
 *
 * A complete rezoning / regulatory reform rewrites the zoning grid, which
 * necessarily includes residential zones — so `indetermine` here means "the
 * minutes did not spell it out", not "this may well be non-residential". Any
 * other instrument (minor derogation, PIIA, …) left at `indetermine` stays a
 * genuine unknown and is NOT eligible.
 */
const RESIDENTIAL_ELIGIBLE_INSTRUMENTS: ReadonlySet<string> = new Set([
  "rezonage",
  "refonte",
]);

/**
 * The `r` axis predicate — SINGLE source of truth shared by the server counters
 * and the client projection, so the rail badge and the panel list can never
 * diverge. Keeps residential `oui`, keeps a rezoning/reform whose residential
 * nature is unstated, and filters out an explicit non-residential.
 */
export function isResidentialEligible(classification: VivierV2): boolean {
  if (classification.residentiel.valeur === "oui") return true;
  if (classification.residentiel.valeur === "non") return false;
  return RESIDENTIAL_ELIGIBLE_INSTRUMENTS.has(classification.instrument);
}

export function countVivierClassifications(
  classifications: readonly VivierV2[],
): VivierCounts {
  const counts = {
    qualified: 0,
    residentialUnknown: 0,
    excludedByReason: emptyExcludedByReason(),
    stageCounts: emptyStageCounts(),
    stageCountsHorsZonage: emptyStageCounts(),
    stageCountsResEligible: emptyStageCounts(),
    stageCountsResEligibleHorsZonage: emptyStageCounts(),
    total: classifications.length,
  };

  for (const classification of classifications) {
    vivierV2Schema.parse(classification);
    if (classification.exclusion_reason !== null) {
      counts.excludedByReason[classification.exclusion_reason] += 1;
      continue;
    }

    // stageCounts contains the server-eligible B perimeter: zonage `oui` and
    // no exclusion. It includes residential `indetermine`, so reforms remain
    // visible without a refonte-to-oui gate. stageCountsHorsZonage holds the
    // same non-excluded records when `z` is relaxed; the two buckets let rail
    // reproduce the panel without reclassification.
    const inPerimeter = classification.zonage.valeur === "oui";
    const resEligible = isResidentialEligible(classification);
    if (inPerimeter) {
      counts.stageCounts[classification.etape] += 1;
      if (resEligible) counts.stageCountsResEligible[classification.etape] += 1;
    } else {
      counts.stageCountsHorsZonage[classification.etape] += 1;
      if (resEligible) counts.stageCountsResEligibleHorsZonage[classification.etape] += 1;
    }

    // `qualified` reste STRICT (résidentiel confirmé `oui`) et `residentialUnknown`
    // = l'indéterminé « à confirmer » : la partition (donc l'invariant
    // total = qualified + residentialUnknown + excluded) est INCHANGÉE.
    if (
      classification.zonage.valeur === "oui" &&
      classification.residentiel.valeur === "oui"
    ) {
      counts.qualified += 1;
    } else {
      counts.residentialUnknown += 1;
    }
  }

  return vivierCountsSchema.parse(counts);
}

export const countVivierV2 = countVivierClassifications;

// Keep the enum values exported next to the counter contract for consumers
// that build records dynamically.
export const vivierEtapes = vivierEtapeSchema.options;
export const vivierExclusionReasons = vivierExclusionReasonSchema.options;
