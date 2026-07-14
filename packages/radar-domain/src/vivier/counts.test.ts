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
  it("counts exclusions by reason and stages only for qualified signals", () => {
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
      stageCounts: {
        avis_motion: 0,
        projet_reglement: 0,
        consultation_publique: 1,
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
});
