/**
 * Tests for the opportunity scoring service (v1).
 *
 * Verifies:
 *   1. scoreProximite — distance bracket mapping (real municipality slugs)
 *   2. scoreZoneType — residential/mixed zone detection
 *   3. scoreRecence — date age bracket mapping
 *   4. scoreOpportunity — composite formula determinism
 *   5. Sort by score descending (used by the opportunites endpoint)
 */

import { describe, it, expect } from "vitest";
import {
  scoreProximite,
  scoreZoneType,
  scoreRecence,
  scoreOpportunity,
  SCORE_WEIGHTS,
  type ScoredEventInput,
} from "./scoring.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a minimal ScoredEventInput for testing. */
function makeEvent(overrides: Partial<ScoredEventInput> = {}): ScoredEventInput {
  return {
    label: "Avis de motion règlement de zonage 1926-26",
    reglementNumbers: ["1926-26"],
    zoneRefs: ["H-431"],
    sourceRef: "raw/proces-verbaux-saint-constant/2026/05/19/abc.txt",
    dateObserved: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. scoreProximite
// ─────────────────────────────────────────────────────────────────────────────

describe("scoreProximite", () => {
  // sainte-catherine: 10.886 km → ≤15 → 1.00
  it("sainte-catherine (10.9 km) → 1.00", () => {
    expect(scoreProximite("sainte-catherine")).toBe(1.00);
  });

  // saint-constant: 17.1 km → ≤25 → 0.80
  it("saint-constant (17.1 km) → 0.80", () => {
    expect(scoreProximite("saint-constant")).toBe(0.80);
  });

  // sainte-martine: 33.8 km → ≤35 → 0.60
  it("sainte-martine (33.8 km) → 0.60", () => {
    expect(scoreProximite("sainte-martine")).toBe(0.60);
  });

  // vaudreuil-dorion: 40.2 km → ≤50 → 0.40
  it("vaudreuil-dorion (40.2 km) → 0.40", () => {
    expect(scoreProximite("vaudreuil-dorion")).toBe(0.40);
  });

  // salaberry-de-valleyfield: 46.9 km → ≤50 → 0.40
  it("salaberry-de-valleyfield (46.9 km) → 0.40", () => {
    expect(scoreProximite("salaberry-de-valleyfield")).toBe(0.40);
  });

  // unknown slug → 0.20 (conservative)
  it("unknown-city → 0.20 (conservative fallback)", () => {
    expect(scoreProximite("unknown-city-xyz")).toBe(0.20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. scoreZoneType
// ─────────────────────────────────────────────────────────────────────────────

describe("scoreZoneType", () => {
  it("H- zone (habitation) → 1.00", () => {
    expect(scoreZoneType(["H-431"])).toBe(1.00);
  });

  it("RM- zone (résidentiel mixte) → 1.00", () => {
    expect(scoreZoneType(["RM-12"])).toBe(1.00);
  });

  it("MXTV- zone (mixte-villageois) → 1.00", () => {
    expect(scoreZoneType(["MxtV-3"])).toBe(1.00);
  });

  it("R- zone (résidentiel générique) → 1.00", () => {
    expect(scoreZoneType(["R-1"])).toBe(1.00);
  });

  it("mixed refs — at least one H- → 1.00", () => {
    expect(scoreZoneType(["C-754", "H-812"])).toBe(1.00);
  });

  it("C- zone only (commercial) → 0.40", () => {
    expect(scoreZoneType(["C-754", "C-810"])).toBe(0.40);
  });

  it("no zone refs → 0.20", () => {
    expect(scoreZoneType([])).toBe(0.20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. scoreRecence
// ─────────────────────────────────────────────────────────────────────────────

describe("scoreRecence", () => {
  const NOW = Date.now();

  function daysAgoIso(days: number): string {
    return new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
  }

  it("10 days ago → 1.00", () => {
    expect(scoreRecence(daysAgoIso(10), NOW)).toBe(1.00);
  });

  it("60 days ago → 0.80", () => {
    expect(scoreRecence(daysAgoIso(60), NOW)).toBe(0.80);
  });

  it("120 days ago → 0.60", () => {
    expect(scoreRecence(daysAgoIso(120), NOW)).toBe(0.60);
  });

  it("200 days ago → 0.40", () => {
    expect(scoreRecence(daysAgoIso(200), NOW)).toBe(0.40);
  });

  it("400 days ago → 0.20", () => {
    expect(scoreRecence(daysAgoIso(400), NOW)).toBe(0.20);
  });

  it("empty string → 0.20 (conservative)", () => {
    expect(scoreRecence("", NOW)).toBe(0.20);
  });

  it("invalid date string → 0.20 (conservative)", () => {
    expect(scoreRecence("not-a-date", NOW)).toBe(0.20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. scoreOpportunity — composite formula
// ─────────────────────────────────────────────────────────────────────────────

describe("scoreOpportunity", () => {
  it("weights sum to 1.0", () => {
    const sum = SCORE_WEIGHTS.proximite + SCORE_WEIGHTS.zoneType + SCORE_WEIGHTS.recence;
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it("score is an integer in [0, 100]", () => {
    const result = scoreOpportunity("saint-constant", makeEvent());
    expect(Number.isInteger(result.score)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("formula: saint-constant (0.80) + H-431 (1.00) + 10d-ago (1.00) → 92", () => {
    // round((0.80×0.40 + 1.00×0.40 + 1.00×0.20) × 100) = round(0.92 × 100) = 92
    const event = makeEvent({
      zoneRefs: ["H-431"],
      dateObserved: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const result = scoreOpportunity("saint-constant", event);
    // proximite=0.80, zoneType=1.00, recence=1.00
    expect(result.facteurs.proximite).toBe(0.80);
    expect(result.facteurs.zoneType).toBe(1.00);
    expect(result.facteurs.recence).toBe(1.00);
    expect(result.score).toBe(92);
  });

  it("formula: vaudreuil-dorion (0.40) + C-zone (0.40) + 400d-ago (0.20) → 36", () => {
    // round((0.40×0.40 + 0.40×0.40 + 0.20×0.20) × 100) = round(0.36 × 100) = 36
    const event = makeEvent({
      zoneRefs: ["C-754"],
      dateObserved: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const result = scoreOpportunity("vaudreuil-dorion", event);
    expect(result.facteurs.proximite).toBe(0.40);
    expect(result.facteurs.zoneType).toBe(0.40);
    expect(result.facteurs.recence).toBe(0.20);
    expect(result.score).toBe(36);
  });

  it("is deterministic — same inputs always yield same score", () => {
    const event = makeEvent();
    const r1 = scoreOpportunity("chateauguay", event);
    const r2 = scoreOpportunity("chateauguay", event);
    expect(r1.score).toBe(r2.score);
    expect(r1.facteurs).toEqual(r2.facteurs);
  });

  it("includes citySlug, reglementNumbers, zoneRefs, label, sourceRef, dateObserved", () => {
    const event = makeEvent();
    const result = scoreOpportunity("saint-constant", event);
    expect(result.citySlug).toBe("saint-constant");
    expect(result.reglementNumbers).toEqual(event.reglementNumbers);
    expect(result.zoneRefs).toEqual(event.zoneRefs);
    expect(result.label).toBe(event.label);
    expect(result.sourceRef).toBe(event.sourceRef);
    expect(result.dateObserved).toBe(event.dateObserved);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Sort by score descending
// ─────────────────────────────────────────────────────────────────────────────

describe("scoreOpportunity — sort by score desc", () => {
  it("higher-proximity + residential-zone yields higher score than low-proximity + commercial", () => {
    const nearEvent = scoreOpportunity("sainte-catherine", makeEvent({ zoneRefs: ["H-1"] }));
    const farEvent = scoreOpportunity("salaberry-de-valleyfield", makeEvent({ zoneRefs: ["C-1"] }));
    expect(nearEvent.score).toBeGreaterThan(farEvent.score);
  });

  it("sorted array is ordered descending by score", () => {
    const now = Date.now();
    const events = [
      scoreOpportunity("salaberry-de-valleyfield", makeEvent({ zoneRefs: [], dateObserved: new Date(now - 400 * 24 * 60 * 60 * 1000).toISOString() })),
      scoreOpportunity("sainte-catherine", makeEvent({ zoneRefs: ["H-1"], dateObserved: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString() })),
      scoreOpportunity("saint-constant", makeEvent({ zoneRefs: ["RM-2"], dateObserved: new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString() })),
    ];
    const sorted = [...events].sort((a, b) => b.score - a.score);
    for (let i = 0; i < sorted.length - 1; i++) {
      expect(sorted[i]!.score).toBeGreaterThanOrEqual(sorted[i + 1]!.score);
    }
    // sainte-catherine should top (closest + H- zone + recent)
    expect(sorted[0]!.citySlug).toBe("sainte-catherine");
  });
});
