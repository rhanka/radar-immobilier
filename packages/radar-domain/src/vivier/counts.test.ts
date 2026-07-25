import { describe, expect, it } from "vitest";
import { countsInvariant, countVivierClassifications, vivierCountsSchema } from "./counts.js";
import { vivierV2Schema, type VivierV2 } from "./vivier-v2.js";

const value = (overrides: Partial<VivierV2> = {}): VivierV2 =>
  vivierV2Schema.parse({
    zonage: { valeur: "oui", source: "test", confiance: 1 },
    residentiel: { valeur: "oui", source: "test", confiance: 1 },
    instrument: "ppcmoi",
    etape: "consultation_publique",
    confiance: 1,
    ...overrides,
  });

describe("vivier_v2 named counts", () => {
  it("counts exclusions by reason and stages for the B-view perimeter (indéterminé GARDÉ)", () => {
    const counts = countVivierClassifications([
      value(),
      value({ residentiel: { valeur: "indetermine", source: "test", confiance: 0 } }),
      value({ exclusion_reason: "piia_non_pertinent", instrument: "piia" }),
      value({ exclusion_reason: "derogation_hors_sujet", instrument: "derogation" }),
      value({ exclusion_reason: "hors_zonage", zonage: { valeur: "non", source: "test", confiance: 1 } }),
    ]);

    expect(counts).toEqual({
      qualified: 1,
      residentialUnknown: 1,
      excludedByReason: {
        non_residentiel_franc: 0,
        piia_non_pertinent: 1,
        hors_zonage: 1,
        derogation_hors_sujet: 1,
      },
      // stageCounts = non-excluded, zonage=oui (oui+indéterminé combined).
      // consultation_publique = 2 (1 qualified + 1 indéterminé).
      stageCounts: {
        avis_motion: 0,
        projet_reglement: 0,
        consultation_publique: 2,
        second_projet: 0,
        adoption: 0,
        entree_vigueur: 0,
        inconnu: 0,
      },
      stageCountsHorsZonage: {
        avis_motion: 0,
        projet_reglement: 0,
        consultation_publique: 0,
        second_projet: 0,
        adoption: 0,
        entree_vigueur: 0,
        inconnu: 0,
      },
      // stageCountsResEligible = only residential=oui within zonage=oui.
      // 1 qualified signal at consultation_publique.
      stageCountsResEligible: {
        avis_motion: 0,
        projet_reglement: 0,
        consultation_publique: 1,
        second_projet: 0,
        adoption: 0,
        entree_vigueur: 0,
        inconnu: 0,
      },
      stageCountsResEligibleHorsZonage: {
        avis_motion: 0,
        projet_reglement: 0,
        consultation_publique: 0,
        second_projet: 0,
        adoption: 0,
        entree_vigueur: 0,
        inconnu: 0,
      },
      total: 5,
    });
    expect(countsInvariant(counts)).toBe(true);
    expect(vivierCountsSchema.parse(counts)).toEqual(counts);
    expect(vivierCountsSchema.safeParse({ ...counts, total: 6 }).success).toBe(false);
  });

  it("garde l'indéterminé précoce dans stageCounts SANS le compter dans qualified (permissif, pas de gate)", () => {
    // Reproduit une refonte réelle sans marqueur résidentiel : zonage=oui,
    // résidentiel=indéterminé, étape précoce. Le badge rail précoce
    // (avis_motion + projet_reglement) DOIT la voir, `qualified` NON.
    const refonteIndeterminee = value({
      residentiel: { valeur: "indetermine", source: "test", confiance: 0 },
      etape: "projet_reglement",
    });
    const counts = countVivierClassifications([refonteIndeterminee]);
    expect(counts.qualified).toBe(0);
    expect(counts.residentialUnknown).toBe(1);
    expect(counts.stageCounts.projet_reglement).toBe(1);
    expect(counts.stageCounts.avis_motion + counts.stageCounts.projet_reglement).toBe(1);
    // stageCountsResEligible excludes the indéterminé — the `r` axis can now filter.
    expect(counts.stageCountsResEligible.projet_reglement).toBe(0);
    expect(countsInvariant(counts)).toBe(true);
  });

  it("ventile le non-exclu HORS zonage dans stageCountsHorsZonage (recomposable, axe Zonage)", () => {
    // Non-exclu mais zonage=INDÉTERMINÉ (hors périmètre) : révélé quand l'axe
    // Zonage est décoché côté UI. Il ne compte PAS dans stageCounts (périmètre
    // zonage=oui) mais dans stageCountsHorsZonage — la somme des deux partitionne
    // exactement (qualified + residentialUnknown), ce qui garantit la parité.
    const horsZonageResidentiel = value({
      zonage: { valeur: "indetermine", source: "test", confiance: 0 },
      residentiel: { valeur: "oui", source: "test", confiance: 1 },
      etape: "avis_motion",
    });
    const perimetre = value({ etape: "adoption" }); // zonage=oui, résidentiel=oui
    const counts = countVivierClassifications([horsZonageResidentiel, perimetre]);
    expect(counts.stageCounts.avis_motion).toBe(0);
    expect(counts.stageCountsHorsZonage.avis_motion).toBe(1);
    expect(counts.stageCounts.adoption).toBe(1);
    // stageCountsResEligible mirrors stageCounts for the residential=oui subset.
    expect(counts.stageCountsResEligible.adoption).toBe(1);
    // horsZonage signal is residential=oui → counted in stageCountsResEligibleHorsZonage.
    expect(counts.stageCountsResEligibleHorsZonage.avis_motion).toBe(1);
    const sumAll = (s: typeof counts.stageCounts) => Object.values(s).reduce((a, b) => a + b, 0);
    expect(sumAll(counts.stageCounts)).toBe(1);
    expect(sumAll(counts.stageCounts) + sumAll(counts.stageCountsHorsZonage)).toBe(
      counts.qualified + counts.residentialUnknown,
    );
    expect(countsInvariant(counts)).toBe(true);
  });

  it("exclut le franc-non-résidentiel du périmètre (n'entre pas dans stageCounts)", () => {
    const commercialFranc = value({
      residentiel: { valeur: "non", source: "test", confiance: 1 },
      exclusion_reason: "non_residentiel_franc",
      etape: "avis_motion",
    });
    const counts = countVivierClassifications([commercialFranc]);
    expect(counts.qualified).toBe(0);
    expect(counts.residentialUnknown).toBe(0);
    expect(counts.excludedByReason.non_residentiel_franc).toBe(1);
    expect(counts.stageCounts.avis_motion).toBe(0);
    expect(counts.stageCountsResEligible.avis_motion).toBe(0);
  });

  it("rejects the non-residential DTO that would split the rail and panel r axis", () => {
    const invalid = {
      ...value(),
      residentiel: { valeur: "non", source: "test", confiance: 1 },
      exclusion_reason: null,
    } as VivierV2;

    expect(vivierV2Schema.safeParse(invalid).success).toBe(false);
    expect(() => countVivierClassifications([invalid])).toThrow(
      "a non-residential classification must have an exclusion reason",
    );
  });
});
