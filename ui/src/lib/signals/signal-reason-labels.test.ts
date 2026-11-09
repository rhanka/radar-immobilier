import { describe, expect, it } from "vitest";
import { REASON_LABELS, reasonEntryLabel, reasonLabel } from "./signal-reason-labels.js";

const EXPECTED_CODES = [
  "P-VILLE-TERRITOIRE", "P-NOUV-ZONE", "P-PERIM-URB", "P-DENSITE",
  "P-USAGE-MULTI", "P-TYPO-INTERM", "P-PROJ-INTEGRE", "P-NORMES",
  "S-MANDAT-AMONT", "S-PLANIFIE", "S-PORTEE-FLOUE", "S-CONTRAINTE",
  "S-RESTRICTIF", "S-INFO-MANQUANTE", "S-PPCMOI-SERIE", "S-PREEMPTION",
  "N-ACCESSOIRE", "N-RETIRE", "N-FORME", "N-ODJ-SEUL", "N-NON-RES",
  "N-ADMIN", "N-RESTRICTIF", "N-UNIFAM", "N-DOUBLON", "N-HORS-TERR",
  "N-FAUX-POSITIF",
];

describe("signal-reason-labels — human-readable reason labels (immo-steve-2026-09)", () => {
  it("covers exactly the 27 P-/S-/N- codes with short fr + en labels", () => {
    expect(Object.keys(REASON_LABELS).sort()).toEqual([...EXPECTED_CODES].sort());
    for (const code of EXPECTED_CODES) {
      for (const locale of ["fr", "en"] as const) {
        const label = REASON_LABELS[code]![locale];
        expect(label.trim().length, `${code}/${locale}`).toBeGreaterThan(0);
        expect(label.trim().split(/\s+/).length, `${code}/${locale}`).toBeLessThanOrEqual(5);
        expect(label, `${code}/${locale}`).not.toBe(code);
      }
    }
  });

  it("resolves known codes in French by default and in English on request", () => {
    expect(reasonLabel("P-DENSITE")).toBe("Hausse de densité");
    expect(reasonLabel("P-DENSITE", "en")).toBe("Increased density");
    expect(reasonLabel("N-ODJ-SEUL")).toBe("Ordre du jour seulement");
  });

  it("falls back to the technical code when a code is missing from the dictionary", () => {
    expect(reasonLabel("V2-PRECEDENT")).toBe("V2-PRECEDENT");
    expect(reasonLabel("X-UNKNOWN")).toBe("X-UNKNOWN");
  });

  it("prefers the dictionary, then a server-provided label, then the code", () => {
    expect(reasonEntryLabel({ code: "P-DENSITE", label: "server label" })).toBe("Hausse de densité");
    expect(reasonEntryLabel({ code: "V2-PRECEDENT", label: "Précédent individuel" })).toBe("Précédent individuel");
    expect(reasonEntryLabel({ code: "V2-PRECEDENT", label: "  " })).toBe("V2-PRECEDENT");
    expect(reasonEntryLabel({ code: "V2-PRECEDENT" })).toBe("V2-PRECEDENT");
  });
});
