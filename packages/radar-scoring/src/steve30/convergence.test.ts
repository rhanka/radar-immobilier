import { describe, it, expect } from "vitest";
import { computeConvergence } from "./convergence.js";

describe("Steve-30 convergence (measured, not fudged)", () => {
  const report = computeConvergence();

  it("measures over the 16 labelled signal rows", () => {
    expect(report.n).toBe(16);
  });

  it("Spearman meets the §4.5 indicative target (≥ 0.75)", () => {
    expect(report.spearman).toBeGreaterThanOrEqual(0.75);
  });

  it("locks the measured v0 Spearman (in-sample calibration)", () => {
    // In-sample value: the weights were calibrated on these same 30 notes,
    // so this is optimistic — the real generalisation test is the 1104 cities.
    expect(report.spearman).toBeCloseTo(0.967, 2);
  });

  it("has no gross inversion between the 8–10/10 and 0–3/10 bands", () => {
    expect(report.grossInversions).toEqual([]);
  });

  it("mean absolute error stays within ~2 points /10 (scale is compressed low)", () => {
    expect(report.meanAbsError).toBeLessThan(2.0);
  });

  it("reports the honest per-city divergences (log for the record)", () => {
    const lines = report.scored.map(
      (s) =>
        `${s.note.toString().padStart(2)}  ${s.score.toFixed(1).padStart(4)}  ` +
        `Δ${s.absError.toFixed(1)}  ${s.city}${s.signalLabel ? ` (${s.signalLabel})` : ""}` +
        `  [${s.dominantFactors.join(", ")}]`,
    );
    console.log(
      `\nSteve-30 convergence v0\n` +
        `  Spearman ρ = ${report.spearman.toFixed(4)}\n` +
        `  mean |Δ|  = ${report.meanAbsError.toFixed(2)} /10\n` +
        `  gross inversions (8-10 vs 0-3) = ${report.grossInversions.length}\n` +
        `  note score  Δ    city  [dominant factors]\n  ` +
        lines.join("\n  "),
    );
    expect(lines.length).toBe(16);
  });
});
