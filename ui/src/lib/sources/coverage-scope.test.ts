/**
 * coverage-scope — portées EXCLUSIVES de la vue Sources/Couverture :
 * « Focus QA : 4 villes » (REFERENCE_CITIES) / « 30 villes à signaux »
 * (présence de signaux, `computeFocusScope`/`isFocusCity` — PLUS priorityRank
 * ≤ 30) / « Toutes ». La portée filtre la LISTE et pilote la COLORATION carte
 * (expression d'opacité) — les deux sont testées ici.
 */
import { describe, it, expect } from "vitest";
import { REFERENCE_CITIES } from "$lib/maps/reference-cities.js";
import {
  buildScopeOpacityExpression,
  cityInScope,
  countCitiesInScope,
  COVERAGE_SCOPE_OPTIONS,
  DEFAULT_COVERAGE_SCOPE,
  filterCitiesByScope,
  isQaReferenceCity,
  QA_REFERENCE_SLUGS,
} from "./coverage-scope.js";
import {
  buildFocusOpacityExpression,
  computeFocusScope,
  type CityCoverage,
} from "./source-coverage-client.js";

/**
 * Fixture minimale — citySlug + NOMBRE DE SIGNAUX pilotent la portée focus30
 * (présence de signaux, plus priorityRank). priorityRank ne sert que de
 * tie-break au classement par signaux.
 */
function city(
  citySlug: string,
  priorityRank: number | null,
  signalCount = 0,
): CityCoverage {
  return {
    citySlug,
    cityName: citySlug,
    mrc: null,
    priorityRank,
    l1Raw: { state: "absent", count: 0, freshness: "unknown" },
    l2Graph: { state: "absent", ontologyVersion: null, freshness: "unknown" },
    signals: {
      state: signalCount > 0 ? "verified" : "absent",
      count: signalCount,
      withCitation: 0,
      freshness: signalCount > 0 ? "fresh" : "unknown",
    },
    l4Zonage: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
    normes: { state: "absent", freshness: "unknown" },
    l5Lots: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
    tod: { state: "absent", served: false, servedBy: null, freshness: "unknown" },
    worstStatus: "absent",
    nextMarginalGain: null,
  };
}

// delson : QA ET à signaux (focus30). la-prairie : à signaux seulement.
// rimouski : proche-ish mais 0 signal → hors focus30. montreal : 0 signal.
const delson = city("delson", 12, 17);
const laPrairie = city("la-prairie", 5, 14);
const rimouski = city("rimouski", 480, 0);
const sansRang = city("montreal", null, 0);
const ALL = [laPrairie, delson, rimouski, sansRang];

describe("QA_REFERENCE_SLUGS — dérivée de la constante canonique", () => {
  it("reprend EXACTEMENT les slugs de REFERENCE_CITIES (aucun re-hardcode)", () => {
    expect([...QA_REFERENCE_SLUGS].sort()).toEqual(
      REFERENCE_CITIES.map((c) => c.slug).sort(),
    );
    // Les 4 villes de contrôle carte-Steve, Delson incluse.
    expect(QA_REFERENCE_SLUGS.size).toBe(4);
    expect(QA_REFERENCE_SLUGS.has("delson")).toBe(true);
    expect(QA_REFERENCE_SLUGS.has("sainte-catherine")).toBe(true);
    expect(QA_REFERENCE_SLUGS.has("saint-constant")).toBe(true);
    expect(QA_REFERENCE_SLUGS.has("candiac")).toBe(true);
  });

  it("isQaReferenceCity vrai pour delson, faux pour la-prairie", () => {
    expect(isQaReferenceCity(delson)).toBe(true);
    expect(isQaReferenceCity(laPrairie)).toBe(false);
  });
});

describe("options du sélecteur radio (exclusif)", () => {
  it("3 portées, dans l'ordre QA → focus 30 → Toutes", () => {
    expect(COVERAGE_SCOPE_OPTIONS.map((o) => o.value)).toEqual([
      "qa4",
      "focus30",
      "all",
    ]);
    expect(COVERAGE_SCOPE_OPTIONS[0].label).toBe("Focus QA : 4 villes");
    expect(COVERAGE_SCOPE_OPTIONS[1].label).toBe("30 villes à signaux");
    expect(COVERAGE_SCOPE_OPTIONS[2].label).toBe("Toutes");
  });

  it("défaut = « Toutes » (comportement Province historique)", () => {
    expect(DEFAULT_COVERAGE_SCOPE).toBe("all");
  });
});

describe("filtre de LISTE par portée", () => {
  it("qa4 → uniquement les villes de contrôle", () => {
    expect(filterCitiesByScope(ALL, "qa4").map((c) => c.citySlug)).toEqual([
      "delson",
    ]);
  });

  it("focus30 → villes À SIGNAUX (0 signal exclu, ordre d'entrée préservé)", () => {
    // delson (17) et la-prairie (14) ont des signaux ; rimouski/montreal 0.
    expect(filterCitiesByScope(ALL, "focus30").map((c) => c.citySlug)).toEqual([
      "la-prairie",
      "delson",
    ]);
  });

  it("bug Steve : ville à signaux LOIN focus30 ; ville proche SANS signal exclue", () => {
    // Mont-Tremblant : 13 signaux, priorityRank 351 (loin) → focus30.
    // Kirkland : 0 signal, priorityRank 30 (proche) → JAMAIS focus30.
    const tremblant = city("mont-tremblant", 351, 13);
    const kirkland = city("kirkland", 30, 0);
    const set = [tremblant, kirkland];
    expect(filterCitiesByScope(set, "focus30").map((c) => c.citySlug)).toEqual([
      "mont-tremblant",
    ]);
    const focusScope = computeFocusScope(set);
    expect(cityInScope(tremblant, "focus30", focusScope)).toBe(true);
    expect(cityInScope(kirkland, "focus30", focusScope)).toBe(false);
  });

  it("all → tout le monde (ordre préservé)", () => {
    expect(filterCitiesByScope(ALL, "all")).toEqual(ALL);
  });

  it("cityInScope/countCitiesInScope cohérents avec le filtre", () => {
    const focusScope = computeFocusScope(ALL);
    expect(cityInScope(sansRang, "focus30", focusScope)).toBe(false);
    expect(cityInScope(sansRang, "all")).toBe(true);
    // Sans focusScope fourni, focus30 est indécidable → false (jamais un faux vrai).
    expect(cityInScope(delson, "focus30")).toBe(false);
    expect(cityInScope(delson, "focus30", focusScope)).toBe(true);
    expect(countCitiesInScope(ALL, "qa4")).toBe(1);
    expect(countCitiesInScope(ALL, "focus30")).toBe(2);
    expect(countCitiesInScope(ALL, "all")).toBe(4);
  });
});

describe("coloration CARTE par portée (expression d'opacité)", () => {
  it("PARITÉ épinglée : all ≡ buildFocusOpacityExpression(…, false)", () => {
    expect(buildScopeOpacityExpression(ALL, "all")).toEqual(
      buildFocusOpacityExpression(ALL, false),
    );
  });

  it("PARITÉ épinglée : focus30 ≡ buildFocusOpacityExpression(…, true)", () => {
    expect(buildScopeOpacityExpression(ALL, "focus30")).toEqual(
      buildFocusOpacityExpression(ALL, true),
    );
  });

  it("qa4 → villes QA opaques, le reste (et le fallback) atténué", () => {
    const expr = buildScopeOpacityExpression(ALL, "qa4") as unknown[];
    expect(expr[0]).toBe("match");
    // Paires slug → opacité : delson surligné, les autres atténués.
    const bySlug = new Map<string, number>();
    for (let i = 2; i < expr.length - 1; i += 2) {
      bySlug.set(expr[i] as string, expr[i + 1] as number);
    }
    expect(bySlug.get("delson")).toBe(0.88);
    expect(bySlug.get("la-prairie")).toBe(0.18);
    expect(bySlug.get("rimouski")).toBe(0.18);
    // Fallback (villes hors couverture) : atténué.
    expect(expr[expr.length - 1]).toBe(0.18);
  });

  it("couverture vide → constante uniforme (jamais un match invalide)", () => {
    expect(buildScopeOpacityExpression([], "qa4")).toBe(0.62);
    expect(buildScopeOpacityExpression([], "all")).toBe(0.62);
  });
});
