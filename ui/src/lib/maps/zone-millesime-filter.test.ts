/**
 * Tests du filtre par MILLÉSIME de zonage (zone-millesime-filter).
 *
 * Vérifie : valeurs présentes triées (plus récent d'abord) + comptes, garde
 * « ≥ 2 millésimes » (dégradé honnête : jamais mono-option), matching EXCLUSIF
 * (un seul millésime, `null` = tous), compteur N/M, peinture pilotée (millésime
 * retenu accentué / hors-millésime estompé mais visible / filtre inactif → null).
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_ZONE_MILLESIME_FILTER,
  isDefaultZoneMillesimeFilter,
  zoneMillesimeValues,
  hasMultipleZoneMillesimes,
  zoneMatchesMillesime,
  countZoneMillesimeMatches,
  zoneMillesimeFilterOpacity,
  ZONE_MILLESIME_FILTER_DIMMED_OPACITY,
  ZONE_MILLESIME_FILTER_MATCH_OPACITY,
} from "./zone-millesime-filter.js";

const MULTI = [
  { reglementMillesime: "2008" },
  { reglementMillesime: "2008" },
  { reglementMillesime: "2020" },
  { reglementMillesime: null }, // sans millésime → ignoré
  { reglementMillesime: "  " }, // vide → ignoré
];

// Cohorte unique (réalité Mont-Tremblant : tout 2008) — le sélecteur DOIT rester masqué.
const MONO = [
  { reglementMillesime: "2008" },
  { reglementMillesime: "2008" },
  { reglementMillesime: null },
];

// ── Valeurs présentes + garde mono-option ─────────────────────────────────────

describe("zoneMillesimeValues — présents, triés (plus récent d'abord), comptés", () => {
  it("ne compte que les millésimes servis, ignore null/vide", () => {
    expect(zoneMillesimeValues(MULTI)).toEqual([
      { millesime: "2020", count: 1 },
      { millesime: "2008", count: 2 },
    ]);
  });

  it("tri numérique décroissant (2020 avant 2008, pas lexical)", () => {
    const values = zoneMillesimeValues([
      { reglementMillesime: "999" },
      { reglementMillesime: "2008" },
    ]);
    expect(values.map((v) => v.millesime)).toEqual(["2008", "999"]);
  });
});

describe("hasMultipleZoneMillesimes — dégradé honnête (jamais mono-option)", () => {
  it("≥ 2 millésimes distincts → true (sélecteur proposable)", () => {
    expect(hasMultipleZoneMillesimes(MULTI)).toBe(true);
  });

  it("une seule cohorte servie (MT = tout 2008) → false (sélecteur masqué)", () => {
    expect(hasMultipleZoneMillesimes(MONO)).toBe(false);
  });

  it("aucun millésime servi → false", () => {
    expect(hasMultipleZoneMillesimes([{ reglementMillesime: null }])).toBe(false);
  });
});

// ── Matching EXCLUSIF ─────────────────────────────────────────────────────────

describe("zoneMatchesMillesime — exclusif, null = tous", () => {
  it("filtre par défaut (null) : toute zone matche", () => {
    expect(isDefaultZoneMillesimeFilter(DEFAULT_ZONE_MILLESIME_FILTER)).toBe(true);
    for (const z of MULTI) {
      expect(zoneMatchesMillesime(z.reglementMillesime, DEFAULT_ZONE_MILLESIME_FILTER)).toBe(true);
    }
  });

  it("un millésime retenu : seules ses zones matchent (exclusif)", () => {
    expect(zoneMatchesMillesime("2008", "2008")).toBe(true);
    expect(zoneMatchesMillesime("2020", "2008")).toBe(false);
    expect(zoneMatchesMillesime(null, "2008")).toBe(false);
  });
});

describe("countZoneMillesimeMatches", () => {
  it("N matchées sur l'ensemble fourni", () => {
    expect(countZoneMillesimeMatches(MULTI, DEFAULT_ZONE_MILLESIME_FILTER)).toBe(MULTI.length);
    expect(countZoneMillesimeMatches(MULTI, "2008")).toBe(2);
    expect(countZoneMillesimeMatches(MULTI, "2020")).toBe(1);
  });
});

// ── Peinture pilotée par le filtre ───────────────────────────────────────────

describe("zoneMillesimeFilterOpacity — peinture pilotée, zéro refetch", () => {
  it("filtre inactif → null (la hiérarchie d'opacité existante s'applique)", () => {
    expect(zoneMillesimeFilterOpacity("2008", DEFAULT_ZONE_MILLESIME_FILTER)).toBeNull();
  });

  it("millésime retenu → accentué ; hors-millésime → estompé, jamais 0", () => {
    expect(zoneMillesimeFilterOpacity("2008", "2008")).toBe(ZONE_MILLESIME_FILTER_MATCH_OPACITY);
    expect(zoneMillesimeFilterOpacity("2020", "2008")).toBe(ZONE_MILLESIME_FILTER_DIMMED_OPACITY);
    // Hors-millésime : estompé mais VISIBLE (opacité strictement positive).
    expect(ZONE_MILLESIME_FILTER_DIMMED_OPACITY).toBeGreaterThan(0);
    expect(ZONE_MILLESIME_FILTER_DIMMED_OPACITY).toBeLessThan(ZONE_MILLESIME_FILTER_MATCH_OPACITY);
  });
});
