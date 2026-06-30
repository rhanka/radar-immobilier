import { describe, expect, it } from "vitest";
import { resolveLotPotentialScore } from "./lot-potential-visual.js";

describe("resolveLotPotentialScore", () => {
  it("uses an API score first", () => {
    expect(resolveLotPotentialScore({ potentialScore: 4.7 })).toMatchObject({
      score: 4.7,
      status: "scored",
      source: "api",
    });
  });

  it("derives a fallback from lot 4+ and TOD flags", () => {
    expect(
      resolveLotPotentialScore({ multifamilial_4plus: true, tod: true }),
    ).toMatchObject({
      score: 7,
      status: "fallback",
      source: "flags",
    });
  });

  it("derives a fallback from a zone object", () => {
    expect(
      resolveLotPotentialScore({
        zone: { kind: "H", usages: ["residential"], densiteLogHa: 80 },
      }),
    ).toMatchObject({
      score: 4,
      status: "fallback",
      source: "zone",
    });
  });

  it("derives a fallback from a generic zone code without city hardcode", () => {
    expect(resolveLotPotentialScore({ zoneCode: "MxtV-4" })).toMatchObject({
      score: 3,
      status: "fallback",
      source: "zone",
    });
  });

  it("returns an explicit unavailable state when no score inputs exist", () => {
    expect(resolveLotPotentialScore({ noLot: "1 234 567" })).toMatchObject({
      score: 0,
      status: "unavailable",
      source: "none",
    });
  });
});
