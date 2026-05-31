import { describe, expect, it } from "vitest";
import { tourSteps } from "./tour-steps.js";

const VALID_VIEWS = ["onboarding", "signaux", "opportunity", "grilles", "console", "automation"] as const;

describe("tourSteps", () => {
  it("contient au moins 12 etapes", () => {
    expect(tourSteps.length).toBeGreaterThanOrEqual(12);
  });

  it("couvre les 6 vues requises", () => {
    const views = new Set(tourSteps.map((s) => s.view));
    for (const v of VALID_VIEWS) {
      expect(views.has(v), `Vue manquante : ${v}`).toBe(true);
    }
  });

  it("chaque etape a un id unique", () => {
    const ids = tourSteps.map((s) => s.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("chaque etape a un titre et un corps non vides", () => {
    for (const step of tourSteps) {
      expect(step.title.trim().length, `titre vide : ${step.id}`).toBeGreaterThan(0);
      expect(step.body.trim().length, `body vide : ${step.id}`).toBeGreaterThan(0);
    }
  });

  it("ne contient pas de tirets cadratins (—)", () => {
    for (const step of tourSteps) {
      expect(step.title, `tiret cadratin dans title : ${step.id}`).not.toContain("—");
      expect(step.body, `tiret cadratin dans body : ${step.id}`).not.toContain("—");
    }
  });

  it("toutes les vues sont des DemoView valides", () => {
    for (const step of tourSteps) {
      expect(VALID_VIEWS).toContain(step.view);
    }
  });

  it("les etapes de chaque vue sont consecutives (pas d'ecrans melanges)", () => {
    let lastView = tourSteps[0].view;
    const seenViews = new Set<string>([lastView]);
    for (const step of tourSteps.slice(1)) {
      if (step.view !== lastView) {
        // On change de vue : elle ne doit pas avoir ete vue avant
        expect(seenViews.has(step.view), `Vue ${step.view} revisitee apres avoir ete quittee`).toBe(false);
        seenViews.add(step.view);
        lastView = step.view;
      }
    }
  });
});
