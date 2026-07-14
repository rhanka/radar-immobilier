import { describe, expect, it } from "vitest";
import {
  VivierV2Schema,
  compareVivier,
  rankReason,
  vivierV2Schema,
  type VivierV2,
  type VivierSortable,
} from "./vivier-v2.js";

const classification = (overrides: Partial<VivierV2> = {}): VivierV2 =>
  vivierV2Schema.parse({
    zonage: { valeur: "oui", source: "test", confiance: 0.9 },
    residentiel: { valeur: "oui", source: "test", confiance: 0.9 },
    instrument: "ppcmoi",
    etape: "consultation_publique",
    confiance: 0.8,
    ...overrides,
  });

const item = (id: string, value: VivierV2, freshness = "2026-01-01T00:00:00Z"): VivierSortable => ({
  id,
  classification: value,
  fraicheur: freshness,
});

describe("vivier_v2 schema", () => {
  it("accepts the signal contract and defaults only the effect", () => {
    const value = VivierV2Schema.parse({
      zonage: { valeur: "indetermine", source: "missing category", confiance: 0 },
      residentiel: { valeur: "indetermine", source: "missing text", confiance: 0 },
      instrument: "autre",
      etape: "inconnu",
      confiance: 0,
    });

    expect(value.effet_densifiant).toBe("inconnu");
    expect(value.etapes_historique).toEqual([]);
    expect(value.exclusion_reason).toBeNull();
    expect(value.provenance.extrait).toBe("");
  });

  it("rejects out-of-range confidence and invented enum values", () => {
    const value = classification();
    expect(vivierV2Schema.safeParse({ ...value, confiance: 1.01 }).success).toBe(false);
    expect(vivierV2Schema.safeParse({ ...value, etape: "consultation" }).success).toBe(false);
    expect(vivierV2Schema.safeParse({ ...value, exclusion_reason: "autre" }).success).toBe(false);
    expect(
      vivierV2Schema.safeParse({
        ...value,
        zonage: { ...value.zonage, source: "" },
      }).success,
    ).toBe(false);
  });
});

describe("vivier_v2 comparator", () => {
  it("orders qualified, residential-unknown and excluded buckets deterministically", () => {
    const qualified = item("qualified", classification());
    const unknownResidential = item(
      "unknown-residential",
      classification({
        residentiel: { valeur: "indetermine", source: "test", confiance: 0 },
      }),
    );
    const excluded = item(
      "excluded",
      classification({ exclusion_reason: "non_residentiel_franc" }),
    );

    expect(compareVivier(qualified, unknownResidential)).toBeLessThan(0);
    expect(compareVivier(unknownResidential, excluded)).toBeLessThan(0);
    expect(compareVivier(item("b", classification()), item("a", classification()))).toBeGreaterThan(0);
    expect(compareVivier(item("a", classification()), item("a", classification()))).toBe(0);
    expect(rankReason(qualified)).toContain("stableKey=qualified");
  });

  it("puts proven densifying effects before an unknown effect", () => {
    const unknown = item("unknown-effect", classification());
    const densifying = item(
      "densifying",
      classification({ effet_densifiant: "densifie", confiance: 0.6 }),
    );
    expect(compareVivier(densifying, unknown)).toBeLessThan(0);
  });

  it("keeps stage and instrument as deterministic tie-breakers", () => {
    const consultation = item(
      "consultation",
      classification({ etape: "consultation_publique", instrument: "ppcmoi" }),
    );
    const secondProject = item(
      "second-project",
      classification({ etape: "second_projet", instrument: "ppcmoi" }),
    );
    const derogation = item(
      "derogation",
      classification({ instrument: "derogation", etape: "consultation_publique" }),
    );
    const piia = item(
      "piia",
      classification({ instrument: "piia", etape: "consultation_publique" }),
    );

    expect(compareVivier(secondProject, consultation)).toBeGreaterThan(0);
    expect(compareVivier(piia, derogation)).toBeLessThan(0);
  });
});
