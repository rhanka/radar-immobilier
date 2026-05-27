import { describe, it, expect } from "vitest";
import { Signal, SignalType, SignalStatus, SIGNAL_TYPE_VALUES } from "./signal.js";

const base = {
  id: "sig-1", type: "residential-rezoning", value: 10, confidence: "high",
  status: "nouveau", sourceRefs: ["avis-1"], detectedAt: "2026-02-25", mode: "real",
};

describe("Signal", () => {
  it("accepts a valid residential-rezoning signal", () => {
    expect(Signal.safeParse(base).success).toBe(true);
  });
  it("rejects an out-of-range value (>10)", () => {
    expect(Signal.safeParse({ ...base, value: 11 }).success).toBe(false);
  });
  it("rejects an unknown type", () => {
    expect(SignalType.safeParse("nope").success).toBe(false);
  });
  it("enumerates the 4 statuses", () => {
    for (const s of ["nouveau", "à-approfondir", "écarté", "surveillance"])
      expect(SignalStatus.safeParse(s).success).toBe(true);
  });
  it("CPTAQ default value outranks PPCMOI (spec §3.2: CPTAQ 8 > PPCMOI 7)", () => {
    expect(SIGNAL_TYPE_VALUES["cptaq"]).toBeGreaterThan(SIGNAL_TYPE_VALUES["ppcmoi"]);
  });
});
