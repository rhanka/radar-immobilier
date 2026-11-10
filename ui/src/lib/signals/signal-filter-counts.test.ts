import { describe, expect, it } from "vitest";
import { filtreCountsFor } from "./signal-filter-counts.js";
import type { GraphSignalNode } from "./graph-signal-detail-client.js";

function node(
  id: string,
  classification: Partial<NonNullable<GraphSignalNode["classification"]>>,
  extra: Partial<GraphSignalNode> = {},
): GraphSignalNode {
  return {
    id, type: "Signal", label: id, citySlug: "delson", sourceRef: null, createdAt: null, props: {},
    classification: {
      zonage: { valeur: "oui", source: "test", confiance: 1 },
      residentiel: { valeur: "oui", source: "test", confiance: 1 },
      effet_densifiant: "inconnu", instrument: "rezonage", etape: "avis_motion",
      etapes_historique: ["avis_motion"], exclusion_reason: null,
      provenance: { extrait: "" }, confiance: 1,
      ...classification,
    } as GraphSignalNode["classification"],
    ...extra,
  };
}

describe("filtreCountsFor — Filtre dropdown counts (period + Pertinence scope)", () => {
  it("counts each axis and each exclusion over the given scoped nodes", () => {
    const counts = filtreCountsFor([
      node("precoce-zonage-res", {}),
      node("tardif-zonage-res", { etape: "adoption" }),
      node("piia-sans-projet", { instrument: "piia", etape: "adoption" }),
      node("derog", { instrument: "derogation", etape: "adoption" }),
      node("hors-zonage", { zonage: { valeur: "non", source: "test", confiance: 1 }, etape: "adoption" }),
    ]);
    // B universe = exclusion_reason null (all five). Zonage oui: 4 (hors-zonage exclu).
    // Résidentiel éligible: rezonage/piia/derog/hors-zonage oui = 5? piia residentiel oui -> eligible.
    // Précoce (avis_motion): seul le premier. PIIA sans projet: 1. Dérogations: 1.
    expect(counts).not.toBeNull();
    expect(counts!.z).toBe(4);
    expect(counts!.p).toBe(1);
    expect(counts!.piia).toBe(1);
    expect(counts!.derog).toBe(1);
  });

  it("excludes server-excluded nodes from the B universe", () => {
    const counts = filtreCountsFor([
      node("ok", {}),
      node("exclu", { exclusion_reason: "hors_zonage" }),
    ]);
    expect(counts).toEqual({ z: 1, r: 1, p: 1, piia: 0, derog: 0 });
  });

  it("returns null when a node has no usable classification (no partial count)", () => {
    const bare = node("bare", {});
    delete bare.classification;
    expect(filtreCountsFor([bare])).toBeNull();
  });

  it("empty scope gives zeroes, not null", () => {
    expect(filtreCountsFor([])).toEqual({ z: 0, r: 0, p: 0, piia: 0, derog: 0 });
  });
});
