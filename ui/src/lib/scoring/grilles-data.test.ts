import { describe, it, expect } from "vitest";
import { toGrilleRows } from "./grilles-data.js";

describe("grille presentation", () => {
  it("produces one row per axis with weight % and 6 levels", () => {
    const rows = toGrilleRows();
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveProperty("weightPct");
    expect(Object.keys(rows[0].levels)).toHaveLength(6);
  });

  it("weight percentages sum to 100", () => {
    const sum = toGrilleRows().reduce((s, r) => s + r.weightPct, 0);
    expect(Math.round(sum)).toBe(100);
  });

  it("each row has axis, label, weightPct, version, and levels 0-5", () => {
    const rows = toGrilleRows();
    for (const row of rows) {
      expect(typeof row.axis).toBe("string");
      expect(typeof row.label).toBe("string");
      expect(typeof row.weightPct).toBe("number");
      expect(typeof row.version).toBe("string");
      expect(Object.keys(row.levels).map(Number).sort()).toEqual([0, 1, 2, 3, 4, 5]);
    }
  });

  it("axes are in the expected order", () => {
    const rows = toGrilleRows();
    const axes = rows.map((r) => r.axis);
    expect(axes).toEqual(["potentiel", "risque", "timing", "faisabilite", "marche"]);
  });

  it("French labels are set for all axes", () => {
    const rows = toGrilleRows();
    const labels = rows.map((r) => r.label);
    expect(labels).toContain("Potentiel réglementaire");
    expect(labels).toContain("Risque de contrainte");
    expect(labels).toContain("Timing");
    expect(labels).toContain("Faisabilité foncière");
    expect(labels).toContain("Valeur marché");
  });
});
