import { describe, it, expect } from "vitest";
import { Signal } from "@radar/domain";
import { demoSignalsT1 } from "./radar-t1-signals.js";
describe("demoSignalsT1", () => {
  it("has 3 real signals, all valid Signals", () => {
    expect(demoSignalsT1.length).toBe(3);
    for (const s of demoSignalsT1) expect(Signal.safeParse(s).success).toBe(true);
  });
  it("all signals are mode:real (no synthetic/invented data)", () => {
    expect(demoSignalsT1.every((s) => s.mode === "real")).toBe(true);
  });
  it("values come from SIGNAL_TYPE_VALUES (residential-rezoning = 10 highest)", () => {
    const rezoning = demoSignalsT1.find((s) => s.type === "residential-rezoning");
    expect(rezoning?.value).toBe(10);
  });
});
