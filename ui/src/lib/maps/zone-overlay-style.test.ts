import { describe, it, expect } from "vitest";
import {
  zoneOverlayPaint,
  ZONE_OUTLINE_PLAN_COLOR,
  ZONE_OUTLINE_PLAN_WIDTH,
  ZONE_OUTLINE_PLAN_OPACITY,
  ZONE_OUTLINE_SAT_WIDTH,
  ZONE_OUTLINE_SAT_OPACITY,
  ZONE_CASING_TOKEN,
  ZONE_CASING_FALLBACK,
  ZONE_CASING_SAT_WIDTH,
  ZONE_CASING_SAT_OPACITY,
} from "./zone-overlay-style.js";

// Expressions opaques factices : on vérifie qu'elles sont repassées TELLES
// QUELLES (identité référentielle), jamais durcies en numérique.
const FAMILY_COLOR = ["get", "familyColor"] as unknown;
const BASE_OPACITY = ["case", ["feature-state", "hover"], 0.55, 0.28] as unknown;
// Couleur casing DÉJÀ résolue depuis le token DS (comme resolveMapColor le ferait).
const RESOLVED_CASING = "#0f172a";

describe("zoneOverlayPaint — mode PLAN (satelliteActive=false)", () => {
  const paint = zoneOverlayPaint(false, FAMILY_COLOR, BASE_OPACITY, RESOLVED_CASING);

  it("aplat : fill-color famille + fill-opacity = expression de base (inchangée)", () => {
    expect(paint.fill["fill-color"]).toBe(FAMILY_COLOR);
    // L'expression immo est repassée par référence, jamais remplacée par un nombre.
    expect(paint.fill["fill-opacity"]).toBe(BASE_OPACITY);
  });

  it("contour : sombre, fin, socle actuel (#0f172a / 1.25 / 0.5)", () => {
    expect(paint.outline["line-color"]).toBe(ZONE_OUTLINE_PLAN_COLOR);
    expect(paint.outline["line-color"]).toBe("#0f172a");
    expect(paint.outline["line-width"]).toBe(ZONE_OUTLINE_PLAN_WIDTH);
    expect(paint.outline["line-width"]).toBe(1.25);
    expect(paint.outline["line-opacity"]).toBe(ZONE_OUTLINE_PLAN_OPACITY);
    expect(paint.outline["line-opacity"]).toBe(0.5);
  });

  it("casing : masqué en plan (line-opacity 0) mais couleur token DS conservée", () => {
    expect(paint.casing["line-opacity"]).toBe(0);
    expect(paint.casing["line-color"]).toBe(RESOLVED_CASING);
  });
});

describe("zoneOverlayPaint — mode SATELLITE (satelliteActive=true) [INTERIM]", () => {
  const paint = zoneOverlayPaint(true, FAMILY_COLOR, BASE_OPACITY, RESOLVED_CASING);

  it("aplat : fill-opacity 0 (imagerie transparaît) mais fill-color famille conservée (hit-area)", () => {
    expect(paint.fill["fill-opacity"]).toBe(0);
    expect(paint.fill["fill-color"]).toBe(FAMILY_COLOR);
  });

  it("contour : couleur FAMILLE (déplacée de l'aplat), 2.25 / 1.0", () => {
    expect(paint.outline["line-color"]).toBe(FAMILY_COLOR);
    expect(paint.outline["line-width"]).toBe(ZONE_OUTLINE_SAT_WIDTH);
    expect(paint.outline["line-width"]).toBe(2.25);
    expect(paint.outline["line-opacity"]).toBe(ZONE_OUTLINE_SAT_OPACITY);
    expect(paint.outline["line-opacity"]).toBe(1);
  });

  it("casing : liseré visible (couleur token DS résolue / 4 / 0.6) sous le contour famille", () => {
    // La couleur du casing est celle PASSÉE (résolue depuis le token DS), pas une
    // constante en dur : geo-owned pour width/opacity, DS-owned pour la couleur.
    expect(paint.casing["line-color"]).toBe(RESOLVED_CASING);
    expect(paint.casing["line-width"]).toBe(ZONE_CASING_SAT_WIDTH);
    expect(paint.casing["line-width"]).toBe(4);
    expect(paint.casing["line-opacity"]).toBe(ZONE_CASING_SAT_OPACITY);
    expect(paint.casing["line-opacity"]).toBe(0.6);
  });
});

describe("zoneOverlayPaint — casing color threadé depuis le token DS", () => {
  it("répercute la couleur casing PASSÉE (ex. valeur résolue d'un theme) dans les deux modes", () => {
    const resolved = "rgb(15, 23, 42)"; // ex. sortie getComputedStyle du token
    const sat = zoneOverlayPaint(true, FAMILY_COLOR, BASE_OPACITY, resolved);
    const plan = zoneOverlayPaint(false, FAMILY_COLOR, BASE_OPACITY, resolved);
    expect(sat.casing["line-color"]).toBe(resolved);
    expect(plan.casing["line-color"]).toBe(resolved);
    // La couleur casing n'est PAS durcie sur le fallback quand un token est fourni.
    expect(sat.casing["line-color"]).not.toBe(ZONE_CASING_FALLBACK);
  });

  it("retombe sur le fallback DS quand casingColor est omis", () => {
    const sat = zoneOverlayPaint(true, FAMILY_COLOR, BASE_OPACITY);
    expect(sat.casing["line-color"]).toBe(ZONE_CASING_FALLBACK);
    expect(sat.casing["line-color"]).toBe("#0f172a");
  });

  it("expose un token de FONDATION theme-invariant (pas un token sémantique)", () => {
    expect(ZONE_CASING_TOKEN).toBe("--st-foundation-color-slate-90");
    // Un token de fondation ne flippe pas en dark, contrairement à --st-semantic-*.
    expect(ZONE_CASING_TOKEN.startsWith("--st-foundation-")).toBe(true);
  });
});

describe("zoneOverlayPaint — invariants inter-modes", () => {
  it("le mode ne modifie que opacité d'aplat + style de contour/casing, la couleur famille reste la même référence", () => {
    const plan = zoneOverlayPaint(false, FAMILY_COLOR, BASE_OPACITY, RESOLVED_CASING);
    const sat = zoneOverlayPaint(true, FAMILY_COLOR, BASE_OPACITY, RESOLVED_CASING);
    expect(plan.fill["fill-color"]).toBe(sat.fill["fill-color"]);
    // Bascule de MEANING : aplat (plan) → contour famille (satellite).
    expect(plan.fill["fill-opacity"]).not.toBe(sat.fill["fill-opacity"]);
    expect(plan.outline["line-color"]).not.toBe(sat.outline["line-color"]);
    expect(plan.casing["line-opacity"]).toBe(0);
    expect(sat.casing["line-opacity"]).toBeGreaterThan(0);
    // Couleur casing identique (DS-owned) dans les deux modes.
    expect(plan.casing["line-color"]).toBe(sat.casing["line-color"]);
  });
});
