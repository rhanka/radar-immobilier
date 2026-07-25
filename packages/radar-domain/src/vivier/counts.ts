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
    // Residential-confirmed subset of stageCounts: zonage `oui`, residential
    // `oui`, no exclusion. Used when the `r` axis is checked (strict mode).
    stageCountsResOui: vivierStageCountsSchema,
    // Residential-confirmed outside zonage `oui`. Combines with
    // stageCountsResOui when both `z` unchecked and `r` checked.
    stageCountsResOuiHorsZonage: vivierStageCountsSchema,
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

export function countVivierClassifications(
  classifications: readonly VivierV2[],
): VivierCounts {
  const counts = {
    qualified: 0,
    residentialUnknown: 0,
    excludedByReason: emptyExcludedByReason(),
    stageCounts: emptyStageCounts(),
    stageCountsHorsZonage: emptyStageCounts(),
    stageCountsResOui: emptyStageCounts(),
    stageCountsResOuiHorsZonage: emptyStageCounts(),
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
    const resOui = classification.residentiel.valeur === "oui";
    if (inPerimeter) {
      counts.stageCounts[classification.etape] += 1;
      if (resOui) counts.stageCountsResOui[classification.etape] += 1;
    } else {
      counts.stageCountsHorsZonage[classification.etape] += 1;
      if (resOui) counts.stageCountsResOuiHorsZonage[classification.etape] += 1;
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
