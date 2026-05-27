import { valleyfieldDossiers } from "@radar/domain";
import { describe, expect, it } from "vitest";
import {
  PHASE_ORDER,
  applyMode,
  deriveTimeline,
  filterDossiersBySignalId,
  groupEvidenceByPhase,
} from "./funnel.js";

const pilot = valleyfieldDossiers[0]; // H-609-4

describe("PHASE_ORDER", () => {
  it("has all six phases in canonical order", () => {
    expect(PHASE_ORDER).toEqual([
      "signal",
      "ancrage",
      "contraintes",
      "marche",
      "contexte",
      "scoring",
    ]);
  });
});

describe("groupEvidenceByPhase", () => {
  it("returns groups in PHASE_ORDER order", () => {
    const groups = groupEvidenceByPhase(pilot);
    const phases = groups.map((g) => g.phase);
    // Should be a subsequence of PHASE_ORDER in the same relative order
    let lastIdx = -1;
    for (const ph of phases) {
      const idx = PHASE_ORDER.indexOf(ph);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });

  it("only includes phases with at least one evidence item", () => {
    const groups = groupEvidenceByPhase(pilot);
    for (const g of groups) {
      expect(g.items.length).toBeGreaterThan(0);
    }
  });

  it("covers all phases present in the pilot dossier", () => {
    const presentPhases = new Set(pilot.evidence.map((e) => e.phase));
    const groupPhases = new Set(groupEvidenceByPhase(pilot).map((g) => g.phase));
    for (const ph of presentPhases) {
      expect(groupPhases.has(ph)).toBe(true);
    }
  });

  it("each group contains the correct evidence items", () => {
    const groups = groupEvidenceByPhase(pilot);
    for (const g of groups) {
      for (const item of g.items) {
        expect(item.phase).toBe(g.phase);
      }
    }
  });

  it("has a French label per phase", () => {
    const groups = groupEvidenceByPhase(pilot);
    const labelMap: Record<string, string> = {
      signal: "Signal",
      ancrage: "Ancrage",
      contraintes: "Contraintes",
      marche: "Marché",
      contexte: "Contexte",
      scoring: "Scoring",
    };
    for (const g of groups) {
      expect(g.label).toBe(labelMap[g.phase]);
    }
  });
});

describe("deriveTimeline", () => {
  it("is sorted ascending by date", () => {
    const timeline = deriveTimeline(pilot);
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i].date >= timeline[i - 1].date).toBe(true);
    }
  });

  it("maps evidence to timeline items with date, phase, label", () => {
    const timeline = deriveTimeline(pilot);
    expect(timeline.length).toBe(pilot.evidence.length);
    for (const item of timeline) {
      expect(typeof item.date).toBe("string");
      expect(PHASE_ORDER).toContain(item.phase);
      expect(typeof item.label).toBe("string");
    }
  });
});

describe("filterDossiersBySignalId", () => {
  it("returns only the H-609-4 dossier for signalId='sig-h609-4'", () => {
    const result = filterDossiersBySignalId(valleyfieldDossiers, "sig-h609-4");
    expect(result).toHaveLength(1);
    expect(result[0].signalId).toBe("sig-h609-4");
  });

  it("returns all 3 dossiers when signalId is undefined", () => {
    const result = filterDossiersBySignalId(valleyfieldDossiers, undefined);
    expect(result).toHaveLength(3);
  });

  it("returns empty array for unknown signalId", () => {
    const result = filterDossiersBySignalId(valleyfieldDossiers, "sig-unknown");
    expect(result).toHaveLength(0);
  });
});

describe("applyMode", () => {
  it("drops simulation row in real mode", () => {
    const items = [{ mode: "real" as const }, { mode: "simulation" as const }];
    const result = applyMode(items, "real");
    expect(result).toHaveLength(1);
    expect(result[0].mode).toBe("real");
  });

  it("keeps both rows in simulation mode", () => {
    const items = [{ mode: "real" as const }, { mode: "simulation" as const }];
    const result = applyMode(items, "simulation");
    expect(result).toHaveLength(2);
  });

  it("drops items with verification='simulé' in real mode", () => {
    const items = [
      { verification: "fait" as const },
      { verification: "simulé" as const },
    ];
    const result = applyMode(items, "real");
    expect(result).toHaveLength(1);
    expect(result[0].verification).toBe("fait");
  });

  it("keeps all items (no mode/verification fields) in real mode", () => {
    const items = [{}, {}];
    const result = applyMode(items, "real");
    expect(result).toHaveLength(2);
  });
});
