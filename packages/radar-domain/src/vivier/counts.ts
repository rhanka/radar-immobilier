import { z } from "zod";
import {
  vivierEtapeSchema,
  vivierExclusionReasonSchema,
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
    stageCounts: vivierStageCountsSchema,
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
    total: classifications.length,
  };

  for (const classification of classifications) {
    if (classification.exclusion_reason !== null) {
      counts.excludedByReason[classification.exclusion_reason] += 1;
      continue;
    }

    // PÉRIMÈTRE de la vue B = « zonage résidentiel, indéterminé GARDÉ »
    // (SPEC_EVOL_FILTRAGE_VIVIER_v2 §9/§34) : zonage `oui` et résidentiel
    // NON-franc (le franc-non-résidentiel porte déjà une exclusion, écartée
    // ci-dessus). `stageCounts` compte CE périmètre par étape — c'est lui que
    // lit le badge rail (`countForVivierCity`), donc une refonte
    // `résidentiel=indéterminé` y remonte SANS gate « refonte→oui ».
    const inPerimeter =
      classification.zonage.valeur === "oui" &&
      classification.residentiel.valeur !== "non";
    if (inPerimeter) {
      counts.stageCounts[classification.etape] += 1;
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
