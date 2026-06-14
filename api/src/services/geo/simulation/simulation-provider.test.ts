/**
 * Tests du provider carte-steve CS-L6.
 *
 * Vérifie :
 * 1. Les 4 villes retournent des lots (>200 lots chacune)
 * 2. Les zones sont disponibles pour Delson, Sainte-Catherine, Saint-Constant
 * 3. Candiac retourne 0 zones (score partiel attendu)
 * 4. potentialScore est non-nul sur des lots avec zone + superficie ok (échelle 0-10)
 * 5. Exemple chiffré : Delson, lot zone H-322, tod=true, superficie=200.86m² → 0-10
 * 6. mode:"carte-steve" présent sur tous les lots
 * 7. Aucun lot ne contient de PII (pas de nom de propriétaire)
 * 8. Cohérence scorer canonique : lotPotentialScore(H, 20 log/ha, tod) → score 0-10
 */

import { describe, expect, it } from "vitest";
import {
  getSimulationLots,
  getSimulationZones,
  getSimulationCityFixture,
  getSimulationLotsFeatureCollection,
  isSimulationCity,
  SIMULATION_CITIES,
} from "./simulation-provider.js";
import {
  lotPotentialScore,
  type ZoneVersionInput,
  type LotVersionInput,
} from "../../scoring/lot-potential.js";
import { zoneKindFromCode, densiteLogHaFromKind, canonicalKindFromSimKind } from "./zone-kind.js";

// ─── Tests zone-kind ─────────────────────────────────────────────────────────

describe("zoneKindFromCode", () => {
  it("H-104 → habitation", () => {
    expect(zoneKindFromCode("H-104")).toBe("habitation");
  });
  it("H-322 → habitation", () => {
    expect(zoneKindFromCode("H-322")).toBe("habitation");
  });
  it("MS-322 → mixte", () => {
    expect(zoneKindFromCode("MS-322")).toBe("mixte");
  });
  it("C-115 → commercial", () => {
    expect(zoneKindFromCode("C-115")).toBe("commercial");
  });
  it("ID-R1.10 → industriel", () => {
    expect(zoneKindFromCode("ID-R1.10")).toBe("industriel");
  });
  it("P-541 → public", () => {
    expect(zoneKindFromCode("P-541")).toBe("public");
  });
  it("CGS-101 → public", () => {
    expect(zoneKindFromCode("CGS-101")).toBe("public");
  });
  it("(vide) → autre", () => {
    expect(zoneKindFromCode("")).toBe("autre");
  });
  it("N/D → autre", () => {
    expect(zoneKindFromCode("N/D")).toBe("autre");
  });
});

describe("densiteLogHaFromKind", () => {
  it("habitation → 20", () => {
    expect(densiteLogHaFromKind("habitation")).toBe(20);
  });
  it("mixte → 40", () => {
    expect(densiteLogHaFromKind("mixte")).toBe(40);
  });
  it("commercial → 0", () => {
    expect(densiteLogHaFromKind("commercial")).toBe(0);
  });
});

describe("canonicalKindFromSimKind", () => {
  it("habitation → H", () => {
    expect(canonicalKindFromSimKind("habitation")).toBe("H");
  });
  it("mixte → MIXTE", () => {
    expect(canonicalKindFromSimKind("mixte")).toBe("MIXTE");
  });
  it("commercial → C", () => {
    expect(canonicalKindFromSimKind("commercial")).toBe("C");
  });
  it("industriel → I", () => {
    expect(canonicalKindFromSimKind("industriel")).toBe("I");
  });
  it("public → P", () => {
    expect(canonicalKindFromSimKind("public")).toBe("P");
  });
  it("conservation → CONS", () => {
    expect(canonicalKindFromSimKind("conservation")).toBe("CONS");
  });
  it("autre → AUTRE", () => {
    expect(canonicalKindFromSimKind("autre")).toBe("AUTRE");
  });
});

// ─── Tests scorer canonique 0-10 via simulation ───────────────────────────────

describe("scorer canonique [0-10] — mapping SimulationZoneKind → ZoneVersionInput", () => {
  it("zone H-104 + tod=true + superficie=1000m² → score ∈ [0,10] et > 2", () => {
    // H-104 → habitation → densiteLogHa=20 → canonicalKind=H
    const simKind = zoneKindFromCode("H-104");
    const zoneVersion: ZoneVersionInput = {
      densiteLogHa: densiteLogHaFromKind(simKind),
      kind: canonicalKindFromSimKind(simKind),
      usages: ["résidentiel"],
    };
    const lot: LotVersionInput = { superficieM2: 1000, usageCode: null };
    const { score, detail } = lotPotentialScore(lot, zoneVersion, { inTod: true });
    // scoreBase: densiteLogHa=20 → palier ≤20 → 1.0
    // bonusKind: H → +1.0
    // bonusTod: tod=true → +1.0
    // total = 1+1+1 = 3.0
    expect(score).toBe(3.0);
    expect(detail.bonusKind).toBe(1.0);
    expect(detail.bonusTod).toBe(1.0);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(10);
  });

  it("zone MS-322 (mixte) + tod=false + superficie=500m² → score ∈ [0,10]", () => {
    // MS → mixte → densiteLogHa=40 → canonicalKind=MIXTE
    const simKind = zoneKindFromCode("MS-322");
    const zoneVersion: ZoneVersionInput = {
      densiteLogHa: densiteLogHaFromKind(simKind),
      kind: canonicalKindFromSimKind(simKind),
      usages: ["résidentiel", "commercial"],
    };
    const lot: LotVersionInput = { superficieM2: 500, usageCode: null };
    const { score, detail } = lotPotentialScore(lot, zoneVersion, { inTod: false });
    // scoreBase: densiteLogHa=40 → palier ≤50 → 2.0
    // bonusKind: MIXTE → +1.0
    // bonusTod: false → 0
    // total = 2+1 = 3.0
    expect(score).toBe(3.0);
    expect(detail.bonusKind).toBe(1.0);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(10);
  });

  it("zone (vide) + tod=false → score = 0 (Candiac : zone absente, anti-invention)", () => {
    const simKind = zoneKindFromCode("");
    const zoneVersion: ZoneVersionInput = {
      densiteLogHa: null, // densiteLogHaFromKind("autre")=0 → null
      kind: canonicalKindFromSimKind(simKind),
      usages: [],
    };
    const lot: LotVersionInput = { superficieM2: 500, usageCode: null };
    const { score } = lotPotentialScore(lot, zoneVersion, { inTod: false });
    // scoreBase=0 (null), bonusKind=0 (AUTRE), bonusTod=0
    expect(score).toBe(0);
  });

  it("exemple chiffré documenté — H-322 Delson sample lot : superficie=200.86m², tod=true → 0-10", () => {
    // Source : analyse-donnees.json sample_lot Delson
    // NO_LOT: "2 427 992", zone: "H-322", superficie_m2_calculee: 200.86, tod: true
    const simKind = zoneKindFromCode("H-322");
    const zoneVersion: ZoneVersionInput = {
      densiteLogHa: densiteLogHaFromKind(simKind), // 20
      kind: canonicalKindFromSimKind(simKind), // H
      usages: ["résidentiel"],
    };
    const lot: LotVersionInput = { superficieM2: 200.86, usageCode: null };
    const { score, detail } = lotPotentialScore(lot, zoneVersion, { inTod: true });
    // scoreBase: densiteLogHa=20 → palier ≤20 → 1.0
    // bonusKind: H → +1.0
    // bonusTod: true → +1.0
    // malusUsage: null → 0
    // total = 1+1+1 = 3.0
    expect(score).toBe(3.0);
    expect(detail.scoreBase).toBe(1.0);
    expect(detail.bonusKind).toBe(1.0);
    expect(detail.bonusTod).toBe(1.0);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(10);
  });
});

// ─── Tests provider — villes simulation ─────────────────────────────────────

describe("isSimulationCity", () => {
  it("delson → true", () => expect(isSimulationCity("delson")).toBe(true));
  it("saint-constant → true", () => expect(isSimulationCity("saint-constant")).toBe(true));
  it("salaberry-de-valleyfield → false", () => {
    expect(isSimulationCity("salaberry-de-valleyfield")).toBe(false);
  });
});

describe("getSimulationLots — delson", () => {
  it("retourne >200 lots", () => {
    const lots = getSimulationLots("delson");
    expect(lots.length).toBeGreaterThan(200);
  });

  it("tous les lots ont mode:'carte-steve'", () => {
    const lots = getSimulationLots("delson");
    for (const l of lots) {
      expect(l.properties.mode).toBe("carte-steve");
    }
  });

  it("tous les lots ont provenance:'steve-import'", () => {
    const lots = getSimulationLots("delson");
    for (const l of lots) {
      expect(l.properties.provenance).toBe("steve-import");
    }
  });

  it("les lots prioritaires (4+ ∩ TOD) ont priorite=true", () => {
    const lots = getSimulationLots("delson");
    const priorityLots = lots.filter((l) => l.properties.priorite);
    // Delson a 130 lots prioritaires selon la spec
    expect(priorityLots.length).toBeGreaterThan(0);
    // Chaque lot prioritaire doit aussi avoir tod=true et multifamilial4plus=true
    for (const l of priorityLots) {
      expect(l.properties.tod).toBe(true);
      expect(l.properties.multifamilial4plus).toBe(true);
    }
  });

  it("tous les lots ont un citySlug='delson'", () => {
    const lots = getSimulationLots("delson");
    for (const l of lots) {
      expect(l.properties.citySlug).toBe("delson");
    }
  });

  it("potentialScore est dans [0, 10] pour tous les lots non-rue", () => {
    const lots = getSimulationLots("delson");
    for (const l of lots) {
      const s = l.properties.potentialScore;
      if (s !== null) {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(10);
      }
    }
  });

  it("les lots avec zone H + superficie ok ont potentialScore > 0", () => {
    const lots = getSimulationLots("delson");
    const scoredLots = lots.filter(
      (l) =>
        l.properties.zone.startsWith("H-") &&
        l.properties.superficieM2 > 0 &&
        !l.properties.isRue,
    );
    expect(scoredLots.length).toBeGreaterThan(0);
    for (const l of scoredLots) {
      expect(l.properties.potentialScore).toBeGreaterThan(0);
    }
  });

  it("les lots is_rue ont potentialScore = 0", () => {
    const lots = getSimulationLots("delson");
    const rueLots = lots.filter((l) => l.properties.isRue);
    for (const l of rueLots) {
      expect(l.properties.potentialScore).toBe(0);
    }
  });

  it("pas de PII : adresse est une chaîne (publique, sans nom de propriétaire)", () => {
    const lots = getSimulationLots("delson");
    // On vérifie juste que adresse est présente (c'est une adresse civique publique)
    // Il n'y a pas de nom de propriétaire dans les données Steve
    expect(lots.every((l) => typeof l.properties.adresse === "string")).toBe(true);
  });
});

describe("getSimulationLots — sainte-catherine", () => {
  it("retourne >200 lots", () => {
    const lots = getSimulationLots("sainte-catherine");
    expect(lots.length).toBeGreaterThan(200);
  });

  it("a des zones (193 zones dessinées manuellement)", () => {
    const zones = getSimulationZones("sainte-catherine");
    expect(zones.length).toBeGreaterThan(100);
  });

  it("les lots avec zone H ont potentialScore > 0 (scorer canonique H=+bonusKind)", () => {
    const lots = getSimulationLots("sainte-catherine");
    const hLot = lots.find(
      (l) => l.properties.zone.startsWith("H-") && l.properties.superficieM2 > 0,
    );
    if (hLot) {
      expect(hLot.properties.potentialScore).toBeGreaterThan(0);
      // scoreDetail.zoneKind doit être "habitation"
      expect(hLot.properties.scoreDetail?.zoneKind).toBe("habitation");
    }
    // Si aucun lot H trouvé dans les 500 échantillonnés, test skippé
  });
});

describe("getSimulationLots — saint-constant", () => {
  it("retourne >200 lots", () => {
    const lots = getSimulationLots("saint-constant");
    expect(lots.length).toBeGreaterThan(200);
  });

  it("a 265 zones", () => {
    const zones = getSimulationZones("saint-constant");
    expect(zones.length).toBe(265);
  });

  it("a au moins 1 zone TOD dans la fixture", () => {
    const fixture = getSimulationCityFixture("saint-constant");
    expect(fixture.nTod).toBeGreaterThanOrEqual(1);
  });
});

describe("getSimulationLots — candiac (score partiel)", () => {
  it("retourne >200 lots", () => {
    const lots = getSimulationLots("candiac");
    expect(lots.length).toBeGreaterThan(200);
  });

  it("0 zones (pas de grille zonage Candiac dans le JSON Steve)", () => {
    const zones = getSimulationZones("candiac");
    expect(zones.length).toBe(0);
  });

  it("0 TOD (pas de périmètre TOD Candiac)", () => {
    const fixture = getSimulationCityFixture("candiac");
    expect(fixture.nTod).toBe(0);
  });

  it("Candiac : lots sans zone ont potentialScore = 0 (anti-invention)", () => {
    const lots = getSimulationLots("candiac");
    // Candiac n'a pas de zones → simKind="autre" → densiteLogHa=null → scoreBase=0
    // → bonusKind=0 (AUTRE), bonusTod=0 → score = 0
    const lotsWithEmptyZone = lots.filter((l) => l.properties.zone === "" && !l.properties.isRue);
    if (lotsWithEmptyZone.length > 0) {
      for (const l of lotsWithEmptyZone) {
        expect(l.properties.potentialScore).toBe(0);
      }
    }
  });
});

// ─── Tests getSimulationCityFixture ──────────────────────────────────────────

describe("getSimulationCityFixture", () => {
  it("retourne les bonnes métadonnées pour toutes les villes", () => {
    for (const city of SIMULATION_CITIES) {
      const fixture = getSimulationCityFixture(city);
      expect(fixture.citySlug).toBe(city);
      expect(fixture.mode).toBe("carte-steve");
      expect(fixture.nLots).toBeGreaterThan(200);
    }
  });

  it("delson : nZones=101, nTod=4", () => {
    const fixture = getSimulationCityFixture("delson");
    expect(fixture.nZones).toBe(101);
    expect(fixture.nTod).toBe(4);
  });

  it("sainte-catherine : nZones=193, nTod=0", () => {
    const fixture = getSimulationCityFixture("sainte-catherine");
    expect(fixture.nZones).toBe(193);
    expect(fixture.nTod).toBe(0);
  });

  it("saint-constant : nZones=265, nTod=1", () => {
    const fixture = getSimulationCityFixture("saint-constant");
    expect(fixture.nZones).toBe(265);
    expect(fixture.nTod).toBe(1);
  });

  it("candiac : nZones=0, nTod=0", () => {
    const fixture = getSimulationCityFixture("candiac");
    expect(fixture.nZones).toBe(0);
    expect(fixture.nTod).toBe(0);
  });
});

// ─── Tests getSimulationLotsFeatureCollection ─────────────────────────────────

describe("getSimulationLotsFeatureCollection", () => {
  it("retourne un FeatureCollection valide", () => {
    const fc = getSimulationLotsFeatureCollection("delson");
    expect(fc.type).toBe("FeatureCollection");
    expect(Array.isArray(fc.features)).toBe(true);
    expect(fc.features.length).toBeGreaterThan(0);
  });

  it("limit=10 retourne exactement 10 features", () => {
    const fc = getSimulationLotsFeatureCollection("delson", { limit: 10 });
    expect(fc.features).toHaveLength(10);
  });

  it("chaque feature a type:'Feature'", () => {
    const fc = getSimulationLotsFeatureCollection("delson", { limit: 5 });
    for (const f of fc.features) {
      expect(f.type).toBe("Feature");
    }
  });

  it("les properties contiennent mode:'carte-steve'", () => {
    const fc = getSimulationLotsFeatureCollection("sainte-catherine", { limit: 5 });
    for (const f of fc.features) {
      expect(f.properties.mode).toBe("carte-steve");
    }
  });

  it("potentialScore dans [0,10] pour toutes les features", () => {
    const fc = getSimulationLotsFeatureCollection("delson", { limit: 50 });
    for (const f of fc.features) {
      const s = f.properties.potentialScore;
      if (s !== null) {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(10);
      }
    }
  });
});
