/**
 * hover-paint — C6 : expressions MapLibre de survol (teinte accentuée,
 * blanc → gris clair).
 */
import { describe, expect, it } from "vitest";
import {
  HOVER_STATE_EXPRESSION,
  HOVER_NEUTRAL_GRAY_FALLBACK,
  withHoverOpacityBoost,
  withHoverNeutralTint,
} from "./hover-paint.js";

describe("withHoverOpacityBoost", () => {
  it("remonte l'opacité au survol via max (jamais en dessous de la base)", () => {
    const base = 0.25;
    const expr = withHoverOpacityBoost(base, 0.55) as unknown[];
    expect(expr[0]).toBe("case");
    expect(expr[1]).toEqual(HOVER_STATE_EXPRESSION);
    // Branche survolée : max(base, plancher) — une sélection à 0.85 reste 0.85.
    expect(expr[2]).toEqual(["max", 0.25, 0.55]);
    // Branche non survolée : opacité de base inchangée.
    expect(expr[3]).toBe(0.25);
  });

  it("accepte une expression match comme base (couche non vide)", () => {
    const base = ["match", ["get", "code"], "H-1", 0.25, 0.15];
    const expr = withHoverOpacityBoost(base, 0.55) as unknown[];
    expect(expr[2]).toEqual(["max", base, 0.55]);
    expect(expr[3]).toEqual(base);
  });
});

describe("withHoverNeutralTint", () => {
  it("grise la teinte BLANCHE au survol, laisse les autres teintes intactes", () => {
    const baseColor = ["coalesce", ["get", "kindColor"], "#ffffff"];
    const expr = withHoverNeutralTint(baseColor, "#ffffff") as unknown[];
    expect(expr[0]).toBe("case");
    // Condition : survolé ET couleur de base = blanc résolu.
    expect(expr[1]).toEqual([
      "all",
      HOVER_STATE_EXPRESSION,
      ["==", baseColor, "#ffffff"],
    ]);
    expect(expr[2]).toBe(HOVER_NEUTRAL_GRAY_FALLBACK);
    expect(expr[3]).toEqual(baseColor);
  });

  it("respecte un gris de survol personnalisé", () => {
    const expr = withHoverNeutralTint("#ffffff", "#ffffff", "#d1d5db") as unknown[];
    expect(expr[2]).toBe("#d1d5db");
  });
});
