import { describe, it, expect } from "vitest";
import { toGrilleRows } from "$lib/scoring/grilles-data.js";
import { valleyfieldDossiers } from "@radar/domain";
import { WEIGHTS, aggregate } from "@radar/scoring";

describe("GrillesView data wiring", () => {
  it("toGrilleRows returns 5 axes", () => {
    const rows = toGrilleRows();
    expect(rows).toHaveLength(5);
  });

  it("all 3 dossiers aggregate without throwing", () => {
    for (const d of valleyfieldDossiers) {
      expect(() => aggregate(d.axes, WEIGHTS)).not.toThrow();
    }
  });

  it("all 3 dossiers yield partial=true (marché is non-disponible)", () => {
    for (const d of valleyfieldDossiers) {
      const result = aggregate(d.axes, WEIGHTS);
      expect(result.partial).toBe(true);
    }
  });

  it("all 3 dossiers cap at qualifier-avec-expert (partial, not tooThin)", () => {
    for (const d of valleyfieldDossiers) {
      const result = aggregate(d.axes, WEIGHTS);
      expect(result.tooThin).toBe(false);
      expect(result.recommendationCap).toBe("qualifier-avec-expert");
    }
  });

  it("dossier 1 (H-609-4) has aggregate score ~3.18", () => {
    const d = valleyfieldDossiers[0];
    const result = aggregate(d.axes, WEIGHTS);
    expect(result.score).not.toBeNull();
    expect(Math.abs((result.score as number) - 3.18)).toBeLessThan(0.05);
  });

  it("dossier 2 (U-521) has aggregate score ~3.35", () => {
    const d = valleyfieldDossiers[1];
    const result = aggregate(d.axes, WEIGHTS);
    expect(result.score).not.toBeNull();
    expect(Math.abs((result.score as number) - 3.35)).toBeLessThan(0.05);
  });

  it("dossier 3 (H-143) has aggregate score ~2.59", () => {
    const d = valleyfieldDossiers[2];
    const result = aggregate(d.axes, WEIGHTS);
    expect(result.score).not.toBeNull();
    expect(Math.abs((result.score as number) - 2.59)).toBeLessThan(0.05);
  });

  it("marché axis is non-disponible in all 3 dossiers", () => {
    for (const d of valleyfieldDossiers) {
      expect(d.axes.marche.availability).toBe("non-disponible");
    }
  });
});
