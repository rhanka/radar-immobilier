import { describe, expect, it } from "vitest";
import {
  classifyLegacyZmpSignal,
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
  it("classifies Sutton legacy memberships once for counts and detail IDs", () => {
    const suton = [
      signal({ id: "sutton-a", category: "rezonage", etape: "avis_motion", nbUnitesMax: "8" }),
      signal({ id: "sutton-t", category: "rezonage", etape: "avis_motion", nbUnitesMax: "2" }),
      signal({ id: "sutton-z", category: "rezonage", etape: "adoption", nbUnitesMax: "2" }),
      signal({ id: "sutton-m", category: "vente_terrain", etape: "adoption", nbUnitesMax: "8" }),
      signal({ id: "sutton-raw", category: "vente_terrain", etape: "adoption", nbUnitesMax: "2" }),
    ];

    const memberships = suton.map(classifyLegacyZmpSignal);
    const counts = computeLegacySubsetCounts(suton);

    expect(memberships.filter((item) => item.flags.z && item.flags.m && item.flags.p).map((item) => item.signalId)).toEqual(["sutton-a"]);
    expect(memberships.filter((item) => item.flags.z && item.flags.p).map((item) => item.signalId)).toEqual(["sutton-a", "sutton-t"]);
    expect(counts[""]).toBe(5);
    expect(counts["z|m|p"]).toBe(1);
    expect(counts["z|p"]).toBe(2);
    expect(memberships.every((item) => item.version === "legacy-zmp-v1")).toBe(true);
  });

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
      signal({
        id: "unknown",
        category: null,
        etape: "consultation_publique",
        label: "Avis de motion",
        description: null,
      }),
      signal({ id: "non-zoning", category: "vente_terrain", etape: null, label: "Projet résidentiel" }),
    ];
    const v2 = computeVivierV2(signals);
    const legacy = computeLegacySubsetCounts(signals);

    expect(v2.classifications).toHaveLength(signals.length);
    expect(v2.counts.total).toBe(signals.length);
    expect(v2.counts.qualified).toBe(1);
    expect(v2.counts.residentialUnknown).toBe(1);
    expect(v2.counts.excludedByReason.hors_zonage).toBe(1);
    expect(v2.classifications[1]?.classification.zonage.valeur).toBe("indetermine");
    expect(v2.classifications[1]?.classification.exclusion_reason).toBeNull();
    expect(v2.classifications[2]?.classification.zonage.valeur).toBe("non");
    expect(legacy[""]).toBe(3);
    expect(legacy.z).toBe(1);
    expect(legacy["z|m|p"]).toBe(0);
  });
});
