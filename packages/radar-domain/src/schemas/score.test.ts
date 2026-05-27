import { describe, it, expect } from "vitest";
import { AxisScore, Axis } from "./score.js";
describe("AxisScore invariant (available ⇔ level≠null)", () => {
  it("accepts available with a level", () => {
    expect(AxisScore.safeParse({ level: 3, availability: "available",
      confidence: "low", evidenceRefs: ["e"], rationale: "r", gridVersion: "v1" }).success).toBe(true);
  });
  it("accepts non-disponible with null level", () => {
    expect(AxisScore.safeParse({ level: null, availability: "non-disponible",
      confidence: "low", evidenceRefs: [], rationale: "r", gridVersion: "v1" }).success).toBe(true);
  });
  it("rejects available with null level", () => {
    expect(AxisScore.safeParse({ level: null, availability: "available",
      confidence: "low", evidenceRefs: [], rationale: "r", gridVersion: "v1" }).success).toBe(false);
  });
  it("rejects non-disponible with a non-null level", () => {
    expect(AxisScore.safeParse({ level: 2, availability: "non-disponible",
      confidence: "low", evidenceRefs: [], rationale: "r", gridVersion: "v1" }).success).toBe(false);
  });
  it("rejects a level out of [0,5]", () => {
    expect(AxisScore.safeParse({ level: 6, availability: "available",
      confidence: "high", evidenceRefs: [], rationale: "r", gridVersion: "v1" }).success).toBe(false);
  });
  it("lists the 5 axes", () => {
    for (const a of ["potentiel","risque","timing","faisabilite","marche"])
      expect(Axis.safeParse(a).success).toBe(true);
  });
});
