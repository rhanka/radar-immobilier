/**
 * Tests d'HONNÊTETÉ (L-honnêteté, anti-survente) de la vue Source.
 *
 * Le sujet de cette vue EST l'honnêteté de la donnée : ces tests verrouillent
 * qu'on ne fabrique jamais de « vert » et que les trois états restent distincts.
 *   - JAMAIS la couleur `verified` si `worstStatus ≠ verified`.
 *   - Ville absente de la couverture → `absent` (gris neutre), pas vert.
 *   - `declared` ≠ `verified` ≠ `absent` (trois couleurs distinctes).
 *   - headline = totals EXACTS de l'endpoint (jamais recalculé/arrondi).
 */
import { describe, expect, it } from "vitest";
import {
  STATE_COLOR,
  colorForState,
  colorForCity,
  buildFillColorExpression,
  buildFocusOpacityExpression,
  isFocusCity,
  buildProvinceHeadline,
  formatProvinceHeadline,
  countCheapZonageCompletions,
  countCheapLotsCompletions,
  sortCitiesForConsole,
  type CityCoverage,
  type CoverageState,
  type CoverageTotals,
} from "./source-coverage-client.js";

// ── Fabrique de ville de test ────────────────────────────────────────────────

function makeCity(overrides: Partial<CityCoverage> = {}): CityCoverage {
  return {
    citySlug: "ville-test",
    cityName: "Ville Test",
    mrc: "MRC Test",
    priorityRank: null,
    l1Raw: { state: "absent", count: 0, freshness: "unknown" },
    l2Graph: { state: "absent", ontologyVersion: null, freshness: "unknown" },
    l4Zonage: { state: "absent", served: false, freshness: "unknown" },
    l5Lots: { state: "absent", served: false, freshness: "unknown" },
    worstStatus: "absent",
    nextMarginalGain: null,
    ...overrides,
  };
}

/** Couleur qu'une ville donnée recevrait via l'expression match (par slug). */
function colorFromExpression(
  expr: unknown[],
  citySlug: string,
): string {
  // expr = ["match", ["get","citySlug"], slug, color, ..., fallback]
  const fallback = expr[expr.length - 1] as string;
  for (let i = 2; i < expr.length - 1; i += 2) {
    if (expr[i] === citySlug) return expr[i + 1] as string;
  }
  return fallback;
}

// ── 1. Trois états distincts (D2) ─────────────────────────────────────────────

describe("tri-état : trois couleurs DISTINCTES", () => {
  it("declared ≠ verified ≠ absent", () => {
    const states: CoverageState[] = ["verified", "declared", "absent"];
    const colors = states.map(colorForState);
    expect(new Set(colors).size).toBe(3);
    expect(STATE_COLOR.verified).not.toBe(STATE_COLOR.declared);
    expect(STATE_COLOR.declared).not.toBe(STATE_COLOR.absent);
    expect(STATE_COLOR.verified).not.toBe(STATE_COLOR.absent);
  });

  it("colorForCity colorie par le PIRE statut, jamais par une couche isolée", () => {
    // Toutes les couches sauf une sont vérifiées, mais worstStatus = declared :
    // la couleur DOIT être declared (ambre), JAMAIS verified (vert).
    const city = makeCity({
      l1Raw: { state: "verified", count: 3, freshness: "fresh" },
      l2Graph: { state: "verified", ontologyVersion: "2.3", freshness: "fresh" },
      l4Zonage: { state: "verified", served: true, freshness: "fresh" },
      l5Lots: { state: "declared", served: false, freshness: "unknown" },
      worstStatus: "declared",
    });
    expect(colorForCity(city)).toBe(STATE_COLOR.declared);
    expect(colorForCity(city)).not.toBe(STATE_COLOR.verified);
  });
});

// ── 2. Expression choroplèthe : jamais de vert fabriqué ───────────────────────

describe("buildFillColorExpression — anti-survente", () => {
  it("colorie chaque ville par worstStatus (jamais verified si worstStatus≠verified)", () => {
    const cities = [
      makeCity({ citySlug: "verte", worstStatus: "verified" }),
      makeCity({ citySlug: "ambre", worstStatus: "declared" }),
      makeCity({ citySlug: "grise", worstStatus: "absent" }),
    ];
    const expr = buildFillColorExpression(cities) as unknown[];
    expect(colorFromExpression(expr, "verte")).toBe(STATE_COLOR.verified);
    expect(colorFromExpression(expr, "ambre")).toBe(STATE_COLOR.declared);
    expect(colorFromExpression(expr, "grise")).toBe(STATE_COLOR.absent);
    // La ville `declared` n'est SURTOUT pas peinte en vert.
    expect(colorFromExpression(expr, "ambre")).not.toBe(STATE_COLOR.verified);
  });

  it("ville ABSENTE de la couverture → absent (gris), jamais vert", () => {
    const cities = [makeCity({ citySlug: "connue", worstStatus: "verified" })];
    const expr = buildFillColorExpression(cities) as unknown[];
    // Ville inconnue du jeu de couverture : retombe sur le fallback = absent.
    const unknownColor = colorFromExpression(expr, "ville-jamais-vue");
    expect(unknownColor).toBe(STATE_COLOR.absent);
    expect(unknownColor).not.toBe(STATE_COLOR.verified);
  });

  it("le fallback de l'expression est la couleur absent (dernier élément)", () => {
    const expr = buildFillColorExpression([]) as unknown[];
    expect(expr[expr.length - 1]).toBe(STATE_COLOR.absent);
  });
});

// ── 3. Focus-30 : highlight visuel, pas un recompute (D3) ─────────────────────

describe("focus-30 highlight", () => {
  it("isFocusCity : rank ≤ 30 oui ; rank null/>30 non", () => {
    expect(isFocusCity(makeCity({ priorityRank: 1 }))).toBe(true);
    expect(isFocusCity(makeCity({ priorityRank: 30 }))).toBe(true);
    expect(isFocusCity(makeCity({ priorityRank: 31 }))).toBe(false);
    expect(isFocusCity(makeCity({ priorityRank: null }))).toBe(false);
  });

  it("mode Province : opacité uniforme (number), pas d'expression par ville", () => {
    const cities = [makeCity({ citySlug: "a", priorityRank: 1 })];
    const op = buildFocusOpacityExpression(cities, false);
    expect(typeof op).toBe("number");
  });

  it("mode Focus 30 : focus opaque, hors-focus atténué, fallback atténué", () => {
    const cities = [
      makeCity({ citySlug: "focus", priorityRank: 5 }),
      makeCity({ citySlug: "horsfocus", priorityRank: 800 }),
    ];
    const expr = buildFocusOpacityExpression(cities, true) as unknown[];
    const focusOp = colorFromExpression(expr, "focus") as unknown as number;
    const dimOp = colorFromExpression(expr, "horsfocus") as unknown as number;
    const fallbackOp = expr[expr.length - 1] as number;
    expect(focusOp).toBeGreaterThan(dimOp);
    expect(fallbackOp).toBe(dimOp);
  });
});

// ── 4. Headline province = totals EXACTS (D7) ─────────────────────────────────

describe("headline province", () => {
  const totals: CoverageTotals = {
    cities: 1104,
    l1Raw: 274,
    l2Graph: 197,
    l4Zonage: 33,
    l5Lots: 12,
  };

  it("formatProvinceHeadline reprend les totals EXACTS sans recalcul", () => {
    expect(formatProvinceHeadline(totals)).toBe(
      "197/1104 graphés · 33/1104 zonage servi · 12/1104 lots servis",
    );
  });

  it("buildProvinceHeadline expose les totals + complétions cheap (zonage)", () => {
    const cities = [
      makeCity({ citySlug: "a", nextMarginalGain: "zonage" }),
      makeCity({ citySlug: "b", nextMarginalGain: "zonage" }),
      makeCity({ citySlug: "c", nextMarginalGain: "lots" }),
      makeCity({ citySlug: "d", nextMarginalGain: null }),
    ];
    const headline = buildProvinceHeadline({ totals, cities });
    expect(headline.cities).toBe(1104);
    expect(headline.l2Graph).toBe(197);
    expect(headline.l4Zonage).toBe(33);
    expect(headline.l5Lots).toBe(12);
    expect(headline.cheapZonage).toBe(2);
  });

  it("countCheapZonage/Lots comptent le prochain gain marginal", () => {
    const cities = [
      makeCity({ nextMarginalGain: "zonage" }),
      makeCity({ nextMarginalGain: "lots" }),
      makeCity({ nextMarginalGain: "lots" }),
      makeCity({ nextMarginalGain: null }),
    ];
    expect(countCheapZonageCompletions(cities)).toBe(1);
    expect(countCheapLotsCompletions(cities)).toBe(2);
  });
});

// ── 5. Tri Console : pires statuts d'abord (action en tête) ───────────────────

describe("sortCitiesForConsole", () => {
  it("trie absent < declared < verified, puis focus-30, puis alpha", () => {
    const cities = [
      makeCity({ citySlug: "v", cityName: "Verte", worstStatus: "verified", priorityRank: 2 }),
      makeCity({ citySlug: "a2", cityName: "Absente Beta", worstStatus: "absent", priorityRank: null }),
      makeCity({ citySlug: "a1", cityName: "Absente Alpha", worstStatus: "absent", priorityRank: 5 }),
      makeCity({ citySlug: "d", cityName: "Declaree", worstStatus: "declared", priorityRank: null }),
    ];
    const sorted = sortCitiesForConsole(cities);
    expect(sorted.map((c) => c.citySlug)).toEqual(["a1", "a2", "d", "v"]);
  });

  it("ne mute pas le tableau d'entrée", () => {
    const cities = [
      makeCity({ citySlug: "x", worstStatus: "verified" }),
      makeCity({ citySlug: "y", worstStatus: "absent" }),
    ];
    const before = cities.map((c) => c.citySlug);
    sortCitiesForConsole(cities);
    expect(cities.map((c) => c.citySlug)).toEqual(before);
  });
});
