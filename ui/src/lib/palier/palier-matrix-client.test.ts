import { describe, expect, it } from "vitest";
import {
  cityResolvedPct,
  kpiResolvedPct,
  palierCellStatusLabel,
  proxyImmoPlaceholderMatrix,
  type PalierMatrix,
} from "./palier-matrix-client.js";

describe("palier-matrix/v1 — couche données", () => {
  it("libellés de statut NEUTRES (aucun jargon interne)", () => {
    expect(palierCellStatusLabel("complete")).toBe("Complet");
    expect(palierCellStatusLabel("incomplete")).toBe("Partiel");
    expect(palierCellStatusLabel("unknown")).toBe("À qualifier");
    expect(palierCellStatusLabel("na")).toBe("N-A");
    // Jamais le mot brut 'unknown'/'honnête' côté client.
    for (const s of ["complete", "incomplete", "unknown", "na"] as const) {
      expect(palierCellStatusLabel(s).toLowerCase()).not.toContain("unknown");
      expect(palierCellStatusLabel(s).toLowerCase()).not.toContain("honn");
    }
  });

  it("cityResolvedPct : % de cellules complètes, N-A EXCLU du dénominateur", () => {
    const row = {
      citySlug: "x",
      cityName: "X",
      cells: [
        { kpiId: "a", status: "complete" as const },
        { kpiId: "b", status: "incomplete" as const },
        { kpiId: "c", status: "na" as const }, // exclu
        { kpiId: "d", status: "na" as const }, // exclu
      ],
    };
    // 1 complète / 2 notées (les 2 N-A exclus) = 50 %.
    expect(cityResolvedPct(row)).toBe(50);
  });

  it("cityResolvedPct : ville 100 % N-A → 0 (pas de division par zéro)", () => {
    expect(
      cityResolvedPct({ citySlug: "x", cityName: "X", cells: [{ kpiId: "a", status: "na" }] }),
    ).toBe(0);
  });

  it("kpiResolvedPct : % de villes complètes pour un KPI (barre par-KPI)", () => {
    const m: PalierMatrix = {
      contract: "palier-matrix/v1",
      subset: "B",
      label: "t",
      kpis: [{ id: "k", label: "K" }],
      cities: [
        { citySlug: "a", cityName: "A", cells: [{ kpiId: "k", status: "complete" }] },
        { citySlug: "b", cityName: "B", cells: [{ kpiId: "k", status: "incomplete" }] },
        { citySlug: "c", cityName: "C", cells: [{ kpiId: "k", status: "na" }] }, // exclu
      ],
    };
    // 1 complète / 2 notées = 50 %.
    expect(kpiResolvedPct(m, "k")).toBe(50);
  });

  it("placeholder proxy-immo : étiqueté honnêtement + 7 villes × 4 KPI", () => {
    const m = proxyImmoPlaceholderMatrix("B");
    expect(m.contract).toBe("palier-matrix/v1");
    expect(m.label).toBe("proxy immo geo-lot pending");
    expect(m.cities).toHaveLength(7);
    expect(m.kpis).toHaveLength(4);
    // chaque ville a exactement une cellule par KPI.
    for (const row of m.cities) expect(row.cells).toHaveLength(4);
  });
});
