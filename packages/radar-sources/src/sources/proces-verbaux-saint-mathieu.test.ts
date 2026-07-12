/**
 * Regression tests for the "analyse au complet" gap (Saint-Mathieu-de-Beloeil).
 *
 * Steve's finding: the residential-densification signal was NOT under the first
 * detected point. It lived under a SECONDARY point (5.9) and in ANNEXE L, and the
 * extraction stopped at the first point it matched — so the real opportunity was
 * lost.
 *
 * These tests pin the FIXED behaviour:
 *   1. `scanHabitationSignals` walks the WHOLE PV (every numbered point + every
 *      annexe) and returns a LIST of habitation/densification segments, each with
 *      its point/annexe locator + a verbatim citation.
 *   2. Point 5.9 (a 24-logement PPCMOI) and ANNEXE L (the grille des usages) are
 *      both surfaced.
 *   3. The old `detectZonageChange` detector, by contrast, only surfaces the decoy
 *      "avis de motion" (point 6.1, a water-tariff bylaw) and MISSES the habitation
 *      opportunity — the exact gap being closed. `habitationSegments` on the same
 *      detection result now carries the full-document scan.
 *
 * The fixture is a synthetic, structure-realistic reproduction (see the fixture
 * header) — anti-invention: it is never presented as real captured bytes.
 */

import { describe, expect, it } from "vitest";
import {
  detectZonageChange,
  scanHabitationSignals,
} from "./proces-verbaux-parser.js";
import { PV_SAINT_MATHIEU_2026_07_TEXT } from "./proces-verbaux-saint-mathieu.fixture.js";

describe("scanHabitationSignals – Saint-Mathieu 5.9 / annexe L (analyse au complet)", () => {
  const segments = scanHabitationSignals(PV_SAINT_MATHIEU_2026_07_TEXT);

  it("returns a LIST covering more than one segment (not a single first hit)", () => {
    expect(Array.isArray(segments)).toBe(true);
    expect(segments.length).toBeGreaterThanOrEqual(2);
  });

  it("surfaces the SECONDARY point 5.9 (the real 24-logement PPCMOI signal)", () => {
    const p59 = segments.find(
      (s) => s.locator === "point" && s.reference === "5.9",
    );
    expect(p59).toBeDefined();
    // Citation is a real, non-empty verbatim excerpt (anti-invention).
    expect((p59?.citation.length ?? 0)).toBeGreaterThan(0);
    // The verbatim habitation/densification terms that fired are aggregated.
    expect(
      p59?.keywords.some((k) => /habitation\s+multifamiliale/i.test(k)),
    ).toBe(true);
    expect(p59?.keywords.some((k) => /logement/i.test(k))).toBe(true);
    // Cross-reference to the annexe is carried on the point segment.
    expect(p59?.annexeRefs).toContain("L");
  });

  it("surfaces ANNEXE L (the grille des usages spelling out the density)", () => {
    const annexeL = segments.find(
      (s) => s.locator === "annexe" && s.reference === "L",
    );
    expect(annexeL).toBeDefined();
    expect((annexeL?.citation.length ?? 0)).toBeGreaterThan(0);
    expect(annexeL?.keywords.some((k) => /logement/i.test(k))).toBe(true);
  });

  it("also surfaces the point 5.1 dérogation mineure (breadth, not first-hit only)", () => {
    const p51 = segments.find(
      (s) => s.locator === "point" && s.reference === "5.1",
    );
    expect(p51).toBeDefined();
    expect(p51?.keywords.some((k) => /d[eé]rogation/i.test(k))).toBe(true);
  });

  it("does NOT invent a habitation segment for the water-tariff point 6.1", () => {
    const p61 = segments.find((s) => s.reference === "6.1");
    expect(p61).toBeUndefined();
  });
});

describe("detectZonageChange – documents the OLD gap (misses 5.9 / annexe L)", () => {
  const detection = detectZonageChange(PV_SAINT_MATHIEU_2026_07_TEXT);

  it("fires on the decoy avis de motion (point 6.1) but not as a zonage change", () => {
    expect(detection.avisDeMotion).toBe(true);
    expect(detection.changementZonage).toBe(false);
  });

  it("its excerpts surface the decoy, NOT the real 5.9/annexe-L habitation signal", () => {
    const joined = detection.excerpts.join(" ").toLowerCase();
    // The only thing the legacy detector surfaces is the water-tariff decoy.
    expect(joined).not.toContain("habitation multifamiliale");
    expect(joined).not.toContain("24 logements");
  });

  it("exposes the full-document scan via habitationSegments (5.9 + annexe L)", () => {
    const refs = detection.habitationSegments.map((s) => s.reference);
    expect(refs).toContain("5.9");
    expect(refs).toContain("L");
  });
});
