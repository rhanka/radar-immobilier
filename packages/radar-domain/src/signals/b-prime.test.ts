import { describe, expect, it } from "vitest";
import { classifyBPrime } from "./b-prime.js";

describe("classifyBPrime", () => {
  it("uses an explicit stage annotation before text and audits an invalid annotation", () => {
    expect(classifyBPrime({ etapeAnnotation: "avis_motion", label: "Adoption" }))
      .toMatchObject({ etape: "avis_motion", etapeAnnotation: { raw: "avis_motion", valid: true } });
    expect(classifyBPrime({ etapeAnnotation: "instrument: refonte", label: "Avis de motion" }))
      .toMatchObject({ etape: "inconnu", etapeAnnotation: { raw: "instrument: refonte", valid: false } });
    expect(classifyBPrime({ etapeAnnotation: "", label: "Avis de motion" }))
      .toMatchObject({ etape: "inconnu", etapeAnnotation: { raw: "", valid: false } });
    expect(classifyBPrime({ etapeAnnotation: "consultation_publique" }))
      .toMatchObject({ etape: "consultation", etapeAnnotation: { raw: "consultation_publique", valid: true } });
  });

  it("keeps complete reforms unknown and excludes commercial or regional-pole signals", () => {
    expect(classifyBPrime({ label: "Révision complète du règlement résidentiel" }))
      .toMatchObject({ residentiel: "indetermine", exclusionReason: null, effetDensifiant: "inconnu" });
    expect(classifyBPrime({ category: " REFONTE " })).toMatchObject({ residentiel: "indetermine" });
    expect(classifyBPrime({ label: "Densification du parc industriel" }))
      .toMatchObject({ residentiel: "non", exclusionReason: "non_residentiel_franc" });
    expect(classifyBPrime({ category: " Commercial " })).toMatchObject({ residentiel: "non" });
    expect(classifyBPrime({
      label: "Pôle commercial régional — projet résidentiel",
      props: { extrait: "Pôle commercial régional", source_ref: "pv-42" },
    })).toMatchObject({
      exclusionReason: "pole_commercial_regional",
      provenance: { extrait: "Pôle commercial régional", source: "pv-42" },
    });
  });
});
