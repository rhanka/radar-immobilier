import { describe, expect, it } from "vitest";
import {
  CIBLAGE_CADENCE_LABELS,
  CiblageCadence,
  CiblagePlan,
  CiblagePlanInput,
  CiblagePlanPatch,
} from "./ciblage.js";

const VALID_PLAN = {
  id: "veille-valleyfield",
  label: "Veille Valleyfield",
  citySlugs: ["salaberry-de-valleyfield"],
  sourceBindingIds: ["avis-publics-valleyfield"],
  cadence: "initial",
  enabled: true,
  notes: "Premier balayage",
  createdAt: "2026-06-09T00:00:00.000Z",
  updatedAt: "2026-06-09T00:00:00.000Z",
} as const;

describe("CiblageCadence", () => {
  it("accepts the three ÉV7 cadences", () => {
    for (const c of ["initial", "recurrent", "approfondissement"] as const) {
      expect(CiblageCadence.parse(c)).toBe(c);
    }
  });

  it("rejects an unknown cadence", () => {
    expect(CiblageCadence.safeParse("daily").success).toBe(false);
  });

  it("has a human label for every cadence", () => {
    for (const c of CiblageCadence.options) {
      expect(CIBLAGE_CADENCE_LABELS[c]).toBeTruthy();
    }
  });
});

describe("CiblagePlan", () => {
  it("parses a valid plan", () => {
    const parsed = CiblagePlan.parse(VALID_PLAN);
    expect(parsed.id).toBe("veille-valleyfield");
    expect(parsed.cadence).toBe("initial");
    expect(parsed.enabled).toBe(true);
  });

  it("defaults citySlugs/sourceBindingIds to empty arrays and enabled to true", () => {
    const parsed = CiblagePlan.parse({
      id: "x",
      label: "X",
      cadence: "recurrent",
      createdAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:00:00.000Z",
    });
    expect(parsed.citySlugs).toEqual([]);
    expect(parsed.sourceBindingIds).toEqual([]);
    expect(parsed.enabled).toBe(true);
    expect(parsed.notes).toBeUndefined();
  });

  it("rejects an empty label", () => {
    expect(CiblagePlan.safeParse({ ...VALID_PLAN, label: "" }).success).toBe(
      false,
    );
  });

  it("rejects a missing id", () => {
    const { id: _id, ...noId } = VALID_PLAN;
    expect(CiblagePlan.safeParse(noId).success).toBe(false);
  });

  it("rejects an invalid cadence", () => {
    expect(
      CiblagePlan.safeParse({ ...VALID_PLAN, cadence: "weekly" }).success,
    ).toBe(false);
  });
});

describe("CiblagePlanInput", () => {
  it("parses the editable surface and ignores id/createdAt", () => {
    const parsed = CiblagePlanInput.parse({
      label: "Veille Beauharnois",
      citySlugs: ["beauharnois"],
      sourceBindingIds: ["avis-publics-beauharnois"],
      cadence: "recurrent",
    });
    expect(parsed.label).toBe("Veille Beauharnois");
    expect(parsed.enabled).toBe(true); // default
    expect("id" in parsed).toBe(false);
  });

  it("rejects a blank label", () => {
    expect(CiblagePlanInput.safeParse({ label: "   ", cadence: "initial" }).success).toBe(
      false,
    );
  });

  it("rejects when cadence is missing", () => {
    expect(CiblagePlanInput.safeParse({ label: "X" }).success).toBe(false);
  });
});

describe("CiblagePlanPatch", () => {
  it("accepts a partial patch (enabled only)", () => {
    const parsed = CiblagePlanPatch.parse({ enabled: false });
    expect(parsed.enabled).toBe(false);
    expect(parsed.label).toBeUndefined();
  });

  it("accepts an empty patch", () => {
    expect(CiblagePlanPatch.parse({})).toEqual({});
  });

  it("rejects an empty-string label in a patch", () => {
    expect(CiblagePlanPatch.safeParse({ label: "" }).success).toBe(false);
  });

  it("rejects an invalid cadence in a patch", () => {
    expect(CiblagePlanPatch.safeParse({ cadence: "annual" }).success).toBe(
      false,
    );
  });
});
