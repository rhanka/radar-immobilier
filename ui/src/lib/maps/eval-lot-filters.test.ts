/**
 * Tests des filtres combinés + peinture filter-aware de la vue Évaluation
 * (eval-lot-filters) — parité carte de référence CS-L6.
 *
 * Vérifie : catégories exclusives (4+/TOD/priorité), usages additifs,
 * superficie min, hiérarchie de couleur marques > priorité > 4+ > TOD > score,
 * estompage des non-matchés (visibles, opacité 0.15), légende hiérarchie.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_EVAL_FILTER,
  isDefaultEvalFilter,
  isPriorite,
  lotUsageGroup,
  lotMatchesEvalFilter,
  countEvalMatches,
  evalLotFillColor,
  evalLotPaint,
  evalHierarchyLegend,
  EVAL_MARKED_FALLBACK,
  EVAL_PRIORITE_FALLBACK,
  EVAL_4PLUS_FALLBACK,
  EVAL_TOD_FALLBACK,
  type EvalLotFilter,
  type UsageGroup,
} from "./eval-lot-filters.js";
import { colorForScore } from "./score-color-scale.js";
import type { LotProperties } from "./lots-client.js";

function props(extra: Partial<LotProperties> = {}): LotProperties {
  return { noLot: "2 181 127", citySlug: "delson", ...extra };
}

function filter(extra: Partial<EvalLotFilter> = {}): EvalLotFilter {
  return { ...DEFAULT_EVAL_FILTER, usages: new Set<UsageGroup>(), ...extra };
}

// ── Catégories exclusives ─────────────────────────────────────────────────────

describe("catégories exclusives", () => {
  it("'all' matche tous les lots", () => {
    expect(lotMatchesEvalFilter(props(), filter())).toBe(true);
    expect(lotMatchesEvalFilter(props({ tod: false }), filter())).toBe(true);
  });

  it("'quatrePlus' ne matche que multifamilial4plus=true (absent = non matché)", () => {
    const f = filter({ category: "quatrePlus" });
    expect(lotMatchesEvalFilter(props({ multifamilial4plus: true }), f)).toBe(true);
    expect(lotMatchesEvalFilter(props({ multifamilial4plus: false }), f)).toBe(false);
    expect(lotMatchesEvalFilter(props(), f)).toBe(false);
  });

  it("'tod' ne matche que tod=true", () => {
    const f = filter({ category: "tod" });
    expect(lotMatchesEvalFilter(props({ tod: true }), f)).toBe(true);
    expect(lotMatchesEvalFilter(props(), f)).toBe(false);
  });

  it("'priorite' : flag source, sinon intersection 4+∩TOD", () => {
    expect(isPriorite(props({ priorite: true }))).toBe(true);
    expect(isPriorite(props({ multifamilial4plus: true, tod: true }))).toBe(true);
    expect(isPriorite(props({ multifamilial4plus: true, tod: false }))).toBe(false);
    expect(isPriorite(props({ potentialScore: 9 }))).toBe(false);
  });
});

// ── Groupes d'usage ───────────────────────────────────────────────────────────

describe("lotUsageGroup", () => {
  it("résout depuis la catégorie du rôle", () => {
    expect(lotUsageGroup(props({ valuation: { categorie: "Résidentiel" } }))).toBe("residentiel");
    expect(lotUsageGroup(props({ valuation: { categorie: "Commercial" } }))).toBe("commercial");
    expect(lotUsageGroup(props({ valuation: { categorie: "Industriel" } }))).toBe("industriel");
    expect(lotUsageGroup(props({ valuation: { categorie: "Mixte" } }))).toBe("mixte");
    expect(lotUsageGroup(props({ valuation: { categorie: "Public" } }))).toBe("public");
    expect(lotUsageGroup(props({ valuation: { categorie: "Institutionnel" } }))).toBe("public");
    expect(lotUsageGroup(props({ valuation: { categorie: "Multi-logements" } }))).toBe("multi");
  });

  it("retombe sur le 1er chiffre CUBF quand la catégorie manque", () => {
    expect(lotUsageGroup(props({ usageCode: "1000" }))).toBe("residentiel");
    expect(lotUsageGroup(props({ usageCode: "3211" }))).toBe("industriel");
    expect(lotUsageGroup(props({ usageCode: "5010" }))).toBe("commercial");
    expect(lotUsageGroup(props({ usageCode: "9100" }))).toBe("vacant");
  });

  it("promeut résidentiel → multi quand nbLogements ≥ 4", () => {
    expect(
      lotUsageGroup(props({ valuation: { categorie: "Résidentiel", nbLogements: 6 } })),
    ).toBe("multi");
    expect(
      lotUsageGroup(props({ valuation: { categorie: "Résidentiel", nbLogements: 2 } })),
    ).toBe("residentiel");
  });

  it("retourne null quand rien n'est résolu (dégradé honnête)", () => {
    expect(lotUsageGroup(props())).toBeNull();
    expect(lotUsageGroup(props({ valuation: { categorie: "Autre" } }))).toBeNull();
  });
});

// ── Filtres combinés ──────────────────────────────────────────────────────────

describe("filtres combinés (catégorie × usage × superficie)", () => {
  const lot4PlusResidentiel600 = props({
    multifamilial4plus: true,
    valuation: { categorie: "Résidentiel" },
    superficieM2: 600,
  });

  it("usage additif : vide = tous, sinon le groupe doit être retenu", () => {
    expect(lotMatchesEvalFilter(lot4PlusResidentiel600, filter())).toBe(true);
    expect(
      lotMatchesEvalFilter(
        lot4PlusResidentiel600,
        filter({ usages: new Set<UsageGroup>(["residentiel"]) }),
      ),
    ).toBe(true);
    expect(
      lotMatchesEvalFilter(
        lot4PlusResidentiel600,
        filter({ usages: new Set<UsageGroup>(["commercial", "industriel"]) }),
      ),
    ).toBe(false);
  });

  it("usage actif + groupe non résolu = non matché (pas d'invention)", () => {
    expect(
      lotMatchesEvalFilter(props(), filter({ usages: new Set<UsageGroup>(["residentiel"]) })),
    ).toBe(false);
  });

  it("superficie min : seuil inclusif, donnée absente = non matché", () => {
    expect(lotMatchesEvalFilter(lot4PlusResidentiel600, filter({ superficieMin: 600 }))).toBe(true);
    expect(lotMatchesEvalFilter(lot4PlusResidentiel600, filter({ superficieMin: 601 }))).toBe(false);
    expect(lotMatchesEvalFilter(props(), filter({ superficieMin: 100 }))).toBe(false);
  });

  it("combinaison complète 4+ × usage × superficie", () => {
    const f = filter({
      category: "quatrePlus",
      usages: new Set<UsageGroup>(["residentiel"]),
      superficieMin: 500,
    });
    expect(lotMatchesEvalFilter(lot4PlusResidentiel600, f)).toBe(true);
    expect(
      lotMatchesEvalFilter(
        props({ multifamilial4plus: true, valuation: { categorie: "Résidentiel" }, superficieM2: 300 }),
        f,
      ),
    ).toBe(false);
  });

  it("countEvalMatches compte les lots matchés", () => {
    const features = [
      { properties: lot4PlusResidentiel600 },
      { properties: props({ tod: true }) },
      { properties: props() },
    ];
    expect(countEvalMatches(features, filter())).toBe(3);
    expect(countEvalMatches(features, filter({ category: "quatrePlus" }))).toBe(1);
    expect(countEvalMatches(features, filter({ category: "tod" }))).toBe(1);
  });

  it("isDefaultEvalFilter détecte l'état neutre", () => {
    expect(isDefaultEvalFilter(filter())).toBe(true);
    expect(isDefaultEvalFilter(filter({ category: "tod" }))).toBe(false);
    expect(isDefaultEvalFilter(filter({ superficieMin: 100 }))).toBe(false);
  });
});

// ── Hiérarchie de couleur ─────────────────────────────────────────────────────

describe("evalLotFillColor — hiérarchie marques > priorité > 4+ > TOD > score", () => {
  it("marque équipe au-dessus de tout", () => {
    expect(evalLotFillColor(props({ priorite: true, multifamilial4plus: true }), true)).toBe(
      EVAL_MARKED_FALLBACK,
    );
  });

  it("priorité (ambre) au-dessus de 4+ et TOD", () => {
    expect(evalLotFillColor(props({ priorite: true, multifamilial4plus: true, tod: true }), false)).toBe(
      EVAL_PRIORITE_FALLBACK,
    );
    // 4+∩TOD = priorité implicite
    expect(evalLotFillColor(props({ multifamilial4plus: true, tod: true }), false)).toBe(
      EVAL_PRIORITE_FALLBACK,
    );
  });

  it("4+ (vert) au-dessus de TOD (bleu)", () => {
    expect(evalLotFillColor(props({ multifamilial4plus: true }), false)).toBe(EVAL_4PLUS_FALLBACK);
    expect(evalLotFillColor(props({ tod: true }), false)).toBe(EVAL_TOD_FALLBACK);
  });

  it("sans flag : rampe de score canonique", () => {
    expect(evalLotFillColor(props({ potentialScore: 4 }), false)).toBe(colorForScore(4, null));
    expect(evalLotFillColor(props(), false)).toBe(colorForScore(0, null));
  });
});

// ── Peinture matché / non-matché ─────────────────────────────────────────────

describe("evalLotPaint — matchés opaques, non-matchés estompés mais visibles", () => {
  const base = { selected: false, hovered: false, marked: false, el: null };

  it("non-matché : estompé (0.15) mais jamais invisible", () => {
    const paint = evalLotPaint(props({ tod: true }), { ...base, matched: false });
    expect(paint.fillOpacity).toBeCloseTo(0.15);
    expect(paint.fillOpacity).toBeGreaterThan(0);
    expect(paint.strokeWidth).toBeLessThan(0.8);
  });

  it("matché avec critère : opaque + bordure renforcée", () => {
    const paint = evalLotPaint(props({ multifamilial4plus: true }), { ...base, matched: true });
    expect(paint.fillOpacity).toBeGreaterThanOrEqual(0.62);
    expect(paint.strokeWidth).toBeGreaterThan(0.8);
    expect(paint.fill).toBe(EVAL_4PLUS_FALLBACK);
  });

  it("sélection : accent maximal même hors filtre", () => {
    const paint = evalLotPaint(props(), { ...base, matched: false, selected: true });
    expect(paint.fillOpacity).toBeCloseTo(0.85);
    expect(paint.strokeWidth).toBeCloseTo(1.6);
  });

  it("lot marqué : couleur marque (rouge DS) prioritaire", () => {
    const paint = evalLotPaint(props({ tod: true }), { ...base, matched: true, marked: true });
    expect(paint.fill).toBe(EVAL_MARKED_FALLBACK);
  });
});

// ── Légende ───────────────────────────────────────────────────────────────────

describe("evalHierarchyLegend", () => {
  it("expose la hiérarchie complète avec les couleurs de tokens DS", () => {
    const legend = evalHierarchyLegend(null);
    expect(legend.map((e) => e.label)).toEqual([
      "Marqué (équipe)",
      "Priorité",
      "Multifamilial 4+",
      "Périmètre TOD",
    ]);
    expect(legend[1].color).toBe(EVAL_PRIORITE_FALLBACK);
  });
});
