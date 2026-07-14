import { describe, expect, it } from "vitest";
import {
  classifyVivierSignal,
  computeLegacySubsetCounts,
  computeVivierV2,
  type VivierSignalInput,
} from "./vivier-v2.js";

const signal = (overrides: Partial<VivierSignalInput> = {}): VivierSignalInput => ({
  id: "signal-1",
  type: "Signal",
  category: "ppcmoi",
  label: "PPCMOI résidentiel",
  description: "Consultation publique",
  etape: "consultation_publique",
  ...overrides,
});

describe("server vivier_v2 computation", () => {
  it("uses the graph-store zonage helper and keeps missing evidence indeterminate", () => {
    const etapeFallback = classifyVivierSignal(
      signal({ category: null, etape: "rezonage", label: "Avis de motion" }),
    );
    expect(etapeFallback.zonage.valeur).toBe("oui");

    const missing = classifyVivierSignal(
      signal({ category: null, etape: null, label: "Avis de motion", description: null }),
    );
    expect(missing.zonage.valeur).toBe("indetermine");
    expect(missing.residentiel.valeur).toBe("indetermine");
    expect(missing.effet_densifiant).toBe("inconnu");
    expect(missing.etape).toBe("avis_motion");
  });

  it("keeps instrument separate from stage and assigns the requested exclusions", () => {
    const ppcmoi = classifyVivierSignal(
      signal({
        category: "ppcmoi",
        label: "Avis de motion PPCMOI résidentiel",
        description: "Second projet de règlement",
        etape: null,
        props: { properties: { etapes_historique: ["avis_motion", "second_projet"] } },
      }),
    );
    expect(ppcmoi.instrument).toBe("ppcmoi");
    expect(ppcmoi.etape).toBe("second_projet");
    expect(ppcmoi.etapes_historique).toEqual(["avis_motion", "second_projet"]);

    const piia = classifyVivierSignal(
      signal({ category: "piia", label: "PIIA centre commercial", description: null }),
    );
    expect(piia.instrument).toBe("piia");
    expect(piia.exclusion_reason).toBe("piia_non_pertinent");

    const derogation = classifyVivierSignal(
      signal({ category: "derogation", label: "Dérogation agricole", description: null }),
    );
    expect(derogation.instrument).toBe("derogation");
    expect(derogation.exclusion_reason).toBe("derogation_hors_sujet");
  });

  it("computes v2 and legacy z|m|p counts from the same input", () => {
    const signals = [
      signal({ id: "qualified", category: "ppcmoi", nbUnitesMax: "8" }),
      signal({ id: "unknown", category: null, etape: null, label: "Avis de motion", description: null }),
      signal({ id: "non-zoning", category: "vente", etape: null, label: "Projet résidentiel" }),
    ];
    const v2 = computeVivierV2(signals);
    const legacy = computeLegacySubsetCounts(signals);

    expect(v2.classifications).toHaveLength(signals.length);
    expect(v2.counts.total).toBe(signals.length);
    expect(v2.counts.qualified).toBe(1);
    expect(v2.counts.residentialUnknown).toBe(1);
    expect(v2.counts.excludedByReason.hors_zonage).toBe(1);
    expect(legacy[""]).toBe(3);
    expect(legacy.z).toBe(1);
    expect(legacy["z|m|p"]).toBe(0);
  });
});
