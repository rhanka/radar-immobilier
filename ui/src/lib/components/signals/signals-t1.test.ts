import { describe, it, expect } from "vitest";
import { demoSignalsT1 } from "$lib/demo/radar-t1-signals.js";
import { filterRealMode } from "@radar/scoring";
import { filterByStatus, sortSignals, buildFeed, markApprofondir } from "$lib/signals/feed.js";

describe("feed.ts — pure sort/filter helpers", () => {
  // (a) sort-by-value desc puts the highest-value signal first
  it("sort by value desc: value-10 signal comes first", () => {
    const sorted = sortSignals(demoSignalsT1, "value", "desc");
    expect(sorted[0].value).toBe(10);
  });

  // (b) confidence ordering: high > medium > low
  it("sort by confidence desc: high-confidence signals before medium and low", () => {
    const sorted = sortSignals(demoSignalsT1, "confidence", "desc");
    const confidences = sorted.map((s) => s.confidence);
    // All "high" rows appear before any "medium" or "low"
    const firstNonHigh = confidences.findIndex((c) => c !== "high");
    const lastHigh = confidences.lastIndexOf("high");
    expect(lastHigh).toBeLessThan(firstNonHigh === -1 ? Infinity : firstNonHigh);
  });

  it("sort by confidence asc: low-confidence signals come first", () => {
    const sorted = sortSignals(demoSignalsT1, "confidence", "asc");
    expect(sorted[0].confidence).toBe("low");
  });

  // (c) filterRealMode drops the 3 simulation rows
  it("filterRealMode drops the 3 simulation rows from demoSignalsT1", () => {
    const real = filterRealMode(demoSignalsT1);
    expect(real).toHaveLength(3);
    expect(real.every((s) => s.mode === "real")).toBe(true);
  });

  it("filterRealMode keeps none of the simulation rows", () => {
    const real = filterRealMode(demoSignalsT1);
    expect(real.some((s) => s.mode === "simulation")).toBe(false);
  });

  // (d) status filter returns only matching rows
  it("filterByStatus 'nouveau' returns only nouveau signals", () => {
    const filtered = filterByStatus(demoSignalsT1, "nouveau");
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((s) => s.status === "nouveau")).toBe(true);
  });

  it("filterByStatus 'écarté' returns only écarté signals", () => {
    const filtered = filterByStatus(demoSignalsT1, "écarté");
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((s) => s.status === "écarté")).toBe(true);
  });

  it("filterByStatus 'tous' returns all signals", () => {
    const filtered = filterByStatus(demoSignalsT1, "tous");
    expect(filtered).toHaveLength(demoSignalsT1.length);
  });

  it("filterByStatus 'surveillance' returns only surveillance signals", () => {
    const filtered = filterByStatus(demoSignalsT1, "surveillance");
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((s) => s.status === "surveillance")).toBe(true);
  });

  it("buildFeed applies filter then sort — écarté + value desc", () => {
    const result = buildFeed(demoSignalsT1, "écarté", "value", "desc");
    expect(result.every((s) => s.status === "écarté")).toBe(true);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].value).toBeGreaterThanOrEqual(result[i].value);
    }
  });

  // (e) Approfondir in-memory mutation — AC#4
  // demoSignalsT1[3] starts as "nouveau" — safe anchor for the immutability check.
  it("markApprofondir sets à-approfondir immutably", () => {
    const target = demoSignalsT1[3]; // status: "nouveau"
    const out = markApprofondir(demoSignalsT1, target.id);
    expect(out.find((s) => s.id === target.id)?.status).toBe("à-approfondir");
    expect(demoSignalsT1[3].status).not.toBe("à-approfondir"); // original untouched
  });
});
