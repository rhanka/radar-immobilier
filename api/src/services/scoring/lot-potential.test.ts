/**
 * Tests unitaires exhaustifs — lotPotentialScore.
 * Pas de DB, pas de réseau, fonction pure.
 */

import { describe, expect, it } from "vitest";
import {
  lotPotentialScore,
  type LotVersionInput,
  type ZoneVersionInput,
} from "./lot-potential.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLot(overrides: Partial<LotVersionInput> = {}): LotVersionInput {
  return { superficieM2: 1000, usageCode: "RU", ...overrides };
}

function makeZone(overrides: Partial<ZoneVersionInput> = {}): ZoneVersionInput {
  return { densiteLogHa: 80, usages: [], kind: "H", ...overrides };
}

// ─── Score de densité (étape 1) ────────────────────────────────────────────────

describe("densiteLogHa → scoreBase", () => {
  it("null → scoreBase 0 (non-disponible)", () => {
    const r = lotPotentialScore(makeLot(), makeZone({ densiteLogHa: null }));
    expect(r.detail.scoreBase).toBe(0);
  });

  it("0 → scoreBase 0 (aucune densité)", () => {
    const r = lotPotentialScore(makeLot(), makeZone({ densiteLogHa: 0 }));
    expect(r.detail.scoreBase).toBe(0);
  });

  it("valeur négative → scoreBase 0 (défense)", () => {
    // La spec définit nonnegative() — mais la fonction doit rester robuste.
    const r = lotPotentialScore(makeLot(), makeZone({ densiteLogHa: -5 }));
    expect(r.detail.scoreBase).toBe(0);
  });

  it("10 log/ha → scoreBase 1.0 (très faible)", () => {
    const r = lotPotentialScore(makeLot(), makeZone({ densiteLogHa: 10 }));
    expect(r.detail.scoreBase).toBe(1.0);
  });

  it("20 log/ha → scoreBase 1.0 (borne basse incluse)", () => {
    const r = lotPotentialScore(makeLot(), makeZone({ densiteLogHa: 20 }));
    expect(r.detail.scoreBase).toBe(1.0);
  });

  it("21 log/ha → scoreBase 2.0 (borne haute exclusive)", () => {
    const r = lotPotentialScore(makeLot(), makeZone({ densiteLogHa: 21 }));
    expect(r.detail.scoreBase).toBe(2.0);
  });

  it("50 log/ha → scoreBase 2.0", () => {
    const r = lotPotentialScore(makeLot(), makeZone({ densiteLogHa: 50 }));
    expect(r.detail.scoreBase).toBe(2.0);
  });

  it("51 log/ha → scoreBase 3.0", () => {
    const r = lotPotentialScore(makeLot(), makeZone({ densiteLogHa: 51 }));
    expect(r.detail.scoreBase).toBe(3.0);
  });

  it("100 log/ha → scoreBase 3.0", () => {
    const r = lotPotentialScore(makeLot(), makeZone({ densiteLogHa: 100 }));
    expect(r.detail.scoreBase).toBe(3.0);
  });

  it("101 log/ha → scoreBase 4.0", () => {
    const r = lotPotentialScore(makeLot(), makeZone({ densiteLogHa: 101 }));
    expect(r.detail.scoreBase).toBe(4.0);
  });

  it("200 log/ha → scoreBase 4.0", () => {
    const r = lotPotentialScore(makeLot(), makeZone({ densiteLogHa: 200 }));
    expect(r.detail.scoreBase).toBe(4.0);
  });

  it("201 log/ha → scoreBase 5.0 (très haute densité)", () => {
    const r = lotPotentialScore(makeLot(), makeZone({ densiteLogHa: 201 }));
    expect(r.detail.scoreBase).toBe(5.0);
  });

  it("500 log/ha → scoreBase 5.0 (plafond)", () => {
    const r = lotPotentialScore(makeLot(), makeZone({ densiteLogHa: 500 }));
    expect(r.detail.scoreBase).toBe(5.0);
  });
});

// ─── Bonus ZoneKind (étape 2a) ─────────────────────────────────────────────────

describe("bonus ZoneKind résidentiel/mixte", () => {
  it("kind H → bonusKind +1.0", () => {
    const r = lotPotentialScore(makeLot(), makeZone({ kind: "H" }));
    expect(r.detail.bonusKind).toBe(1.0);
  });

  it("kind MIXTE → bonusKind +1.0", () => {
    const r = lotPotentialScore(makeLot(), makeZone({ kind: "MIXTE" }));
    expect(r.detail.bonusKind).toBe(1.0);
  });

  it("kind C → bonusKind 0 (pas résidentiel)", () => {
    const r = lotPotentialScore(makeLot(), makeZone({ kind: "C" }));
    expect(r.detail.bonusKind).toBe(0.0);
  });

  it("kind I → bonusKind 0", () => {
    const r = lotPotentialScore(makeLot(), makeZone({ kind: "I" }));
    expect(r.detail.bonusKind).toBe(0.0);
  });

  it("kind P → bonusKind 0 (parc)", () => {
    const r = lotPotentialScore(makeLot(), makeZone({ kind: "P" }));
    expect(r.detail.bonusKind).toBe(0.0);
  });
});

// ─── Bonus TOD (étape 2b) ─────────────────────────────────────────────────────

describe("bonus TOD", () => {
  it("inTod true → bonusTod +1.0", () => {
    const r = lotPotentialScore(makeLot(), makeZone(), { inTod: true });
    expect(r.detail.bonusTod).toBe(1.0);
  });

  it("inTod false → bonusTod 0", () => {
    const r = lotPotentialScore(makeLot(), makeZone(), { inTod: false });
    expect(r.detail.bonusTod).toBe(0.0);
  });

  it("inTod omis → bonusTod 0 (false par défaut)", () => {
    const r = lotPotentialScore(makeLot(), makeZone());
    expect(r.detail.bonusTod).toBe(0.0);
  });
});

// ─── Malus usage non-constructible (étape 2c) ─────────────────────────────────

describe("malus usageCode non-constructible", () => {
  it("usageCode BO (boisé) → malusUsage -1.0", () => {
    const r = lotPotentialScore(makeLot({ usageCode: "BO" }), makeZone());
    expect(r.detail.malusUsage).toBe(-1.0);
  });

  it("usageCode TE (terrain naturel) → malusUsage -1.0", () => {
    const r = lotPotentialScore(makeLot({ usageCode: "TE" }), makeZone());
    expect(r.detail.malusUsage).toBe(-1.0);
  });

  it("usageCode RU (résidentiel) → malusUsage 0", () => {
    const r = lotPotentialScore(makeLot({ usageCode: "RU" }), makeZone());
    expect(r.detail.malusUsage).toBe(0.0);
  });

  it("usageCode CH → malusUsage 0", () => {
    const r = lotPotentialScore(makeLot({ usageCode: "CH" }), makeZone());
    expect(r.detail.malusUsage).toBe(0.0);
  });

  it("usageCode null → malusUsage 0 (inconnu = pas de malus)", () => {
    const r = lotPotentialScore(makeLot({ usageCode: null }), makeZone());
    expect(r.detail.malusUsage).toBe(0.0);
  });
});

// ─── Bonus reconvertible (étape 2d) ───────────────────────────────────────────

describe("bonus zone reconvertible", () => {
  it("kind C → bonusReconvertible +0.5", () => {
    const r = lotPotentialScore(makeLot(), makeZone({ kind: "C" }));
    expect(r.detail.bonusReconvertible).toBe(0.5);
  });

  it("kind U → bonusReconvertible +0.5", () => {
    const r = lotPotentialScore(makeLot(), makeZone({ kind: "U" }));
    expect(r.detail.bonusReconvertible).toBe(0.5);
  });

  it("kind I → bonusReconvertible +0.5", () => {
    const r = lotPotentialScore(makeLot(), makeZone({ kind: "I" }));
    expect(r.detail.bonusReconvertible).toBe(0.5);
  });

  it("kind H → bonusReconvertible 0 (déjà résidentiel)", () => {
    const r = lotPotentialScore(makeLot(), makeZone({ kind: "H" }));
    expect(r.detail.bonusReconvertible).toBe(0.0);
  });

  it("kind A → bonusReconvertible 0", () => {
    const r = lotPotentialScore(makeLot(), makeZone({ kind: "A" }));
    expect(r.detail.bonusReconvertible).toBe(0.0);
  });
});

// ─── Pré-filtres ───────────────────────────────────────────────────────────────

describe("pré-filtre superficieMinM2", () => {
  it("superficieM2 < min → score 0, filteredOut true", () => {
    const r = lotPotentialScore(
      makeLot({ superficieM2: 300 }),
      makeZone(),
      { filters: { superficieMinM2: 500 } },
    );
    expect(r.score).toBe(0);
    expect(r.detail.filteredOut).toBe(true);
    expect(r.detail.filteredReason).toContain("300");
  });

  it("superficieM2 === min → pas filtré", () => {
    const r = lotPotentialScore(
      makeLot({ superficieM2: 500 }),
      makeZone(),
      { filters: { superficieMinM2: 500 } },
    );
    expect(r.detail.filteredOut).toBe(false);
  });

  it("superficieM2 > min → pas filtré", () => {
    const r = lotPotentialScore(
      makeLot({ superficieM2: 1000 }),
      makeZone(),
      { filters: { superficieMinM2: 500 } },
    );
    expect(r.detail.filteredOut).toBe(false);
  });

  it("superficieM2 null → pas filtré (inconnu)", () => {
    const r = lotPotentialScore(
      makeLot({ superficieM2: null }),
      makeZone(),
      { filters: { superficieMinM2: 500 } },
    );
    expect(r.detail.filteredOut).toBe(false);
    expect(r.score).toBeGreaterThan(0);
  });
});

describe("pré-filtre excludeUsageCodes", () => {
  it("usageCode dans la liste → score 0, filteredOut true", () => {
    const r = lotPotentialScore(
      makeLot({ usageCode: "BO" }),
      makeZone(),
      { filters: { excludeUsageCodes: ["BO", "TE"] } },
    );
    expect(r.score).toBe(0);
    expect(r.detail.filteredOut).toBe(true);
  });

  it("usageCode pas dans la liste → pas filtré", () => {
    const r = lotPotentialScore(
      makeLot({ usageCode: "RU" }),
      makeZone(),
      { filters: { excludeUsageCodes: ["BO", "TE"] } },
    );
    expect(r.detail.filteredOut).toBe(false);
  });

  it("usageCode null → pas filtré", () => {
    const r = lotPotentialScore(
      makeLot({ usageCode: null }),
      makeZone(),
      { filters: { excludeUsageCodes: ["BO", "TE"] } },
    );
    expect(r.detail.filteredOut).toBe(false);
  });
});

// ─── Score final (clamp + arrondi) ────────────────────────────────────────────

describe("score final — clamp 0–10 et arrondi 1 décimale", () => {
  it("lot tout null → score 0 (100% calculable)", () => {
    const r = lotPotentialScore(
      { superficieM2: null, usageCode: null },
      { densiteLogHa: null, usages: [], kind: "AUTRE" },
    );
    expect(r.score).toBe(0);
    expect(r.detail.filteredOut).toBe(false);
  });

  it("lot H + densité 80 + TOD → score = 3 + 1 + 1 = 5.0", () => {
    const r = lotPotentialScore(
      makeLot({ usageCode: "RU" }),
      makeZone({ densiteLogHa: 80, kind: "H" }),
      { inTod: true },
    );
    expect(r.score).toBe(5.0);
    expect(r.detail.scoreBase).toBe(3.0);
    expect(r.detail.bonusKind).toBe(1.0);
    expect(r.detail.bonusTod).toBe(1.0);
  });

  it("lot H + densité 250 + TOD → score = 5 + 1 + 1 = 7.0", () => {
    const r = lotPotentialScore(
      makeLot({ usageCode: "RU" }),
      makeZone({ densiteLogHa: 250, kind: "H" }),
      { inTod: true },
    );
    expect(r.score).toBe(7.0);
  });

  it("lot MIXTE + densité 500 + TOD → score = 5 + 1 + 1 = 7.0 (pas de double-bonus reconvertible)", () => {
    const r = lotPotentialScore(
      makeLot({ usageCode: "RU" }),
      makeZone({ densiteLogHa: 500, kind: "MIXTE" }),
      { inTod: true },
    );
    expect(r.score).toBe(7.0);
  });

  it("lot C + densité 250 + TOD → score = 5 + 0 + 1 + 0.5 = 6.5", () => {
    const r = lotPotentialScore(
      makeLot({ usageCode: "RU" }),
      makeZone({ densiteLogHa: 250, kind: "C" }),
      { inTod: true },
    );
    expect(r.score).toBe(6.5);
  });

  it("lot BO + zone H + densité haute → malus réduit le score", () => {
    const r = lotPotentialScore(
      makeLot({ usageCode: "BO" }),
      makeZone({ densiteLogHa: 80, kind: "H" }),
    );
    // scoreBase=3 + bonusKind=1 + malusUsage=-1 = 3
    expect(r.score).toBe(3.0);
    expect(r.detail.malusUsage).toBe(-1.0);
  });

  it("score ne peut pas descendre sous 0 (clamp)", () => {
    const r = lotPotentialScore(
      makeLot({ usageCode: "BO" }),
      { densiteLogHa: null, usages: [], kind: "A" },
    );
    // scoreBase=0 + malusUsage=-1 → clampé à 0
    expect(r.score).toBe(0);
  });

  it("score ne peut pas dépasser 10 (clamp)", () => {
    // Même combinaison maximale : scoreBase=5 + bonusKind=1 + bonusTod=1 = 7 < 10
    // Les combinaisons possibles ne dépassent pas 7 en pratique.
    const r = lotPotentialScore(
      makeLot({ usageCode: "RU" }),
      makeZone({ densiteLogHa: 500, kind: "H" }),
      { inTod: true },
    );
    expect(r.score).toBeLessThanOrEqual(10);
  });

  it("résultat arrondi à 1 décimale", () => {
    const r = lotPotentialScore(
      makeLot({ usageCode: "RU" }),
      makeZone({ densiteLogHa: 250, kind: "C" }),
      { inTod: true },
    );
    // 5 + 0 + 1 + 0.5 = 6.5 — déjà une décimale propre
    expect(r.score.toString()).toMatch(/^\d+(\.\d)?$/);
  });
});

// ─── Cas réels (exemples concrets du domaine) ─────────────────────────────────

describe("cas réels domaine", () => {
  it("lot résidentiel typique Valleyfield — zone H, densité moyenne", () => {
    // Zone H-609-4 (Valleyfield) avec densiteLogHa ≈ 60–80
    const r = lotPotentialScore(
      { superficieM2: 14990, usageCode: "RU" },
      { densiteLogHa: 70, usages: [], kind: "H" },
    );
    // scoreBase=3 + bonusKind=1 = 4
    expect(r.score).toBe(4.0);
  });

  it("lot boisé hors-filtre — zone A, densité nulle", () => {
    const r = lotPotentialScore(
      { superficieM2: 50000, usageCode: "BO" },
      { densiteLogHa: null, usages: [], kind: "A" },
    );
    // scoreBase=0 + malusUsage=-1 → clampé 0
    expect(r.score).toBe(0);
  });

  it("lot commercial reconvertible + TOD — zone C, haute densité", () => {
    const r = lotPotentialScore(
      { superficieM2: 5000, usageCode: "CH" },
      { densiteLogHa: 150, usages: [], kind: "C" },
      { inTod: true },
    );
    // scoreBase=4 + bonusKind=0 + bonusTod=1 + bonusReconvertible=0.5 = 5.5
    expect(r.score).toBe(5.5);
  });

  it("lot industriel reconvertible sans TOD", () => {
    const r = lotPotentialScore(
      { superficieM2: 20000, usageCode: "AV" },
      { densiteLogHa: 40, usages: [], kind: "I" },
    );
    // scoreBase=2 + bonusReconvertible=0.5 = 2.5
    expect(r.score).toBe(2.5);
  });

  it("lot sans aucun info connu → score 0, non filtré", () => {
    const r = lotPotentialScore(
      { superficieM2: null, usageCode: null },
      { densiteLogHa: null, usages: [], kind: "AUTRE" },
    );
    expect(r.score).toBe(0);
    expect(r.detail.filteredOut).toBe(false);
  });
});

// ─── Cohérence du détail ──────────────────────────────────────────────────────

describe("cohérence score = somme composantes", () => {
  it("score = clamp(scoreBase + bonusKind + bonusTod + malusUsage + bonusReconvertible)", () => {
    const cases: Array<[LotVersionInput, ZoneVersionInput, { inTod?: boolean }]> = [
      [makeLot(), makeZone({ densiteLogHa: 80, kind: "H" }), { inTod: true }],
      [makeLot({ usageCode: "BO" }), makeZone({ densiteLogHa: 200, kind: "C" }), {}],
      [makeLot({ usageCode: null }), makeZone({ densiteLogHa: null, kind: "AUTRE" }), {}],
      [makeLot(), makeZone({ densiteLogHa: 15, kind: "I" }), { inTod: false }],
    ];

    for (const [lot, zone, opts] of cases) {
      const r = lotPotentialScore(lot, zone, opts);
      if (!r.detail.filteredOut) {
        const expected =
          Math.round(
            Math.max(
              0,
              Math.min(
                10,
                r.detail.scoreBase +
                  r.detail.bonusKind +
                  r.detail.bonusTod +
                  r.detail.malusUsage +
                  r.detail.bonusReconvertible,
              ),
            ) * 10,
          ) / 10;
        expect(r.score).toBe(expected);
      }
    }
  });
});
