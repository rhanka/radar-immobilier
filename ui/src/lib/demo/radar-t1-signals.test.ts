import { describe, it, expect } from "vitest";
import { Signal } from "@radar/domain";
import { demoSignalsT1 } from "./radar-t1-signals.js";
describe("demoSignalsT1", () => {
  it("has ≥5 signals, all valid Signals", () => {
    expect(demoSignalsT1.length).toBeGreaterThanOrEqual(5);
    for (const s of demoSignalsT1) expect(Signal.safeParse(s).success).toBe(true);
  });
  it("covers all 4 statuses and both modes", () => {
    const statuses = new Set(demoSignalsT1.map((s) => s.status));
    expect(statuses.size).toBe(4);
    expect(new Set(demoSignalsT1.map((s) => s.mode))).toEqual(new Set(["real", "simulation"]));
  });
  it("values come from SIGNAL_TYPE_VALUES (residential-rezoning = 10 highest)", () => {
    const rezoning = demoSignalsT1.find((s) => s.type === "residential-rezoning");
    expect(rezoning?.value).toBe(10);
  });
});
