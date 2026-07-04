/**
 * coverage-scope — portées EXCLUSIVES de la vue Sources/Couverture :
 * « Focus QA : 4 villes » (REFERENCE_CITIES) / « Villes à signaux précoces »
 * (villes portant ≥ 1 signal PRIORITAIRE z∩m∩p — zonage ∩ multifamilial 4+ ∩
 * précoce, `computeFocusScope`/`isFocusCity` ; ni priorityRank ≤ 30, ni top 30
 * par volume) / « Toutes ». La portée filtre la LISTE et pilote la COLORATION
 * carte (expression d'opacité) — les deux sont testées ici.
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
 * Fixture minimale — citySlug + SIGNAUX PRIORITAIRES z∩m∩p (`priority`)
 * pilotent la portée focus30 (villes portant les signaux prioritaires — ni
 * priorityRank, ni volume brut de signaux).
 */
function city(
  citySlug: string,
  priorityRank: number | null,
  signalCount = 0,
  prioritySignals = 0,
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
      priority: prioritySignals,
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

// delson : QA, à signaux dont 1 prioritaire (focus30). la-prairie : 1 signal
// prioritaire. lyster : GROS volume de signaux mais 0 prioritaire → hors
// focus30 (le volume ne compte pas). rimouski-0 : 0 signal. montreal : 0 signal.
const delson = city("delson", 12, 17, 1);
const laPrairie = city("la-prairie", 5, 14, 1);
const lyster = city("lyster", 550, 400, 0);
const sansRang = city("montreal", null, 0, 0);
const ALL = [laPrairie, delson, lyster, sansRang];

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
    // Le focus n'est PAS « 30 villes » : c'est l'ensemble data-driven des
    // villes portant les signaux prioritaires z∩m∩p (~30 mesurées).
    expect(COVERAGE_SCOPE_OPTIONS[1].label).toBe("Villes à signaux précoces");
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

  it("focus30 → villes à signaux PRIORITAIRES (volume brut exclu, ordre d'entrée préservé)", () => {
    // delson et la-prairie portent 1 signal prioritaire z∩m∩p chacune ;
    // lyster (400 signaux, 0 prioritaire) et montreal (0 signal) sont exclues.
    expect(filterCitiesByScope(ALL, "focus30").map((c) => c.citySlug)).toEqual([
      "la-prairie",
      "delson",
    ]);
  });

  it("bug Steve : ville à signal prioritaire LOIN focus30 ; proche sans signal ET gros volume exclues", () => {
    // Mont-Tremblant : 2 signaux prioritaires z∩m∩p, priorityRank 351 (loin)
    // → focus30. Kirkland : 0 signal, rang 30 (proche) → JAMAIS focus30.
    // Lyster : 400 signaux mais 0 prioritaire → JAMAIS focus30 (pas un top-N).
    const tremblant = city("mont-tremblant", 351, 13, 2);
    const kirkland = city("kirkland", 30, 0, 0);
    const gros = city("lyster", 550, 400, 0);
    const set = [tremblant, kirkland, gros];
    expect(filterCitiesByScope(set, "focus30").map((c) => c.citySlug)).toEqual([
      "mont-tremblant",
    ]);
    const focusScope = computeFocusScope(set);
    expect(cityInScope(tremblant, "focus30", focusScope)).toBe(true);
    expect(cityInScope(kirkland, "focus30", focusScope)).toBe(false);
    expect(cityInScope(gros, "focus30", focusScope)).toBe(false);
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
    expect(bySlug.get("lyster")).toBe(0.18);
    // Fallback (villes hors couverture) : atténué.
    expect(expr[expr.length - 1]).toBe(0.18);
  });

  it("couverture vide → constante uniforme (jamais un match invalide)", () => {
    expect(buildScopeOpacityExpression([], "qa4")).toBe(0.62);
    expect(buildScopeOpacityExpression([], "all")).toBe(0.62);
  });
});
