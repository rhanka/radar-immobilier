import { describe, it, expect } from "vitest";
import {
  SCORE_STOPS,
  lotFillColorExpression,
  lotFillOpacityExpression,
  lotLineColorExpression,
  colorForScore,
  scoreLegend,
  resolveToken,
  ZONE_LABEL_MINZOOM,
} from "./score-color-scale.js";

// The score ramp MUST derive from DS tokens, never invented palettes.
describe("score-color-scale — DS-token-driven ramp", () => {
  it("every stop points to a design-system token (--st-semantic-*)", () => {
    for (const s of SCORE_STOPS) {
      expect(s.token.startsWith("--st-semantic-")).toBe(true);
    }
  });

  it("stops are sorted ascending across [0,1]", () => {
    const stops = SCORE_STOPS.map((s) => s.stop);
    expect(stops[0]).toBe(0);
    expect(stops[stops.length - 1]).toBe(1);
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i]).toBeGreaterThan(stops[i - 1]);
    }
  });

  it("builds a MapLibre interpolate expression on potentialScore", () => {
    const expr = lotFillColorExpression();
    expect(expr[0]).toBe("interpolate");
    expect(expr[1]).toEqual(["linear"]);
    expect(expr[2]).toEqual(["get", "potentialScore"]);
    // header (3) + 2 entries (stop,color) per stop
    expect(expr.length).toBe(3 + SCORE_STOPS.length * 2);
  });

  it("fill expression uses token fallbacks when no DOM element is provided", () => {
    const expr = lotFillColorExpression(null);
    // colors at odd positions after the 3-item header
    expect(expr).toContain(SCORE_STOPS[0].fallback);
    expect(expr).toContain(SCORE_STOPS[SCORE_STOPS.length - 1].fallback);
  });

  it("opacity expression boosts priorité lots", () => {
    const expr = lotFillOpacityExpression();
    expect(expr[0]).toBe("case");
    expect(expr[1]).toEqual(["get", "priorite"]);
    expect(expr[2]).toBeGreaterThan(expr[3] as number);
  });

  it("line color uses warning token (fallback) for priorité", () => {
    const expr = lotLineColorExpression(null);
    expect(expr[0]).toBe("case");
    // priority branch = warning token fallback
    expect(expr[2]).toBe("#d97706");
  });

  it("resolveToken returns fallback outside the DOM", () => {
    expect(resolveToken("--st-semantic-feedback-success", "#16a34a", null)).toBe("#16a34a");
  });

  it("colorForScore returns a token fallback at the extremes", () => {
    expect(colorForScore(0, null)).toBe(SCORE_STOPS[0].fallback);
    expect(colorForScore(1, null)).toBe(SCORE_STOPS[SCORE_STOPS.length - 1].fallback);
  });

  it("colorForScore clamps and interpolates between hex token fallbacks", () => {
    const c = colorForScore(0.575, null); // halfway between 0.45 and 0.7 stops
    expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("scoreLegend lists priorité first and maps token colors", () => {
    const legend = scoreLegend(null);
    expect(legend.length).toBe(SCORE_STOPS.length);
    expect(legend[0].label).toContain("Priorité");
    expect(legend[0].color).toBe("#d97706");
  });

  it("exposes zone-label minzoom parity (14)", () => {
    expect(ZONE_LABEL_MINZOOM).toBe(14);
  });
});
