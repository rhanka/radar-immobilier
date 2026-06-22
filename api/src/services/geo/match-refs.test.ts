/**
 * Tests unitaires du module de matching multi-niveau (match-refs.ts).
 *
 * Pas d'accès DB réelle — GeoMatchDb injecté avec des mocks.
 *
 * Couvre :
 * - levenshtein / levenshteinNorm
 * - zoneCodeVariants
 * - matchZoneMultiLevel : N1 exact, N2 variantes, N3 edit-distance, N4 city_fallback
 * - Non-résolus : no_polygon, ambiguous
 * - isMatchResult type guard
 */

import { describe, expect, it } from "vitest";
import {
  levenshtein,
  levenshteinNorm,
  zoneCodeVariants,
  matchZoneMultiLevel,
  isMatchResult,
  EDIT_DIST_THRESHOLD,
  VARIANT_SCORE_FACTOR,
  EDIT_DIST_SCORE_FACTOR,
  CITY_FALLBACK_SCORE_FACTOR,
  pickLotForCity,
  type GeoMatchDb,
} from "./match-refs.js";

// ─── pickLotForCity (précision lot cross-ville) ───────────────────────────────

describe("pickLotForCity", () => {
  it("aucun candidat → null", () => {
    expect(pickLotForCity([], "saint-amable")).toBeNull();
  });

  it("préfère le lot de la ville du signal", () => {
    const got = pickLotForCity(
      [
        { canonicalId: "ogc:lots:saint-mathieu-de-beloeil:6609778", citySlug: "saint-mathieu-de-beloeil" },
        { canonicalId: "ogc:lots:saint-amable:6609778", citySlug: "saint-amable" },
      ],
      "saint-amable",
    );
    expect(got).toBe("ogc:lots:saint-amable:6609778");
  });

  it("cross-ville accepté si non-ambigu (une seule ville candidate)", () => {
    const got = pickLotForCity(
      [{ canonicalId: "ogc:lots:coaticook:2935698", citySlug: "coaticook" }],
      "hatley-township-municipality",
    );
    expect(got).toBe("ogc:lots:coaticook:2935698");
  });

  it("cross-ville ambigu (plusieurs villes, aucune n'est celle du signal) → null", () => {
    const got = pickLotForCity(
      [
        { canonicalId: "ogc:lots:saint-amable:5881201", citySlug: "saint-amable" },
        { canonicalId: "ogc:lots:saint-mathieu-de-beloeil:5881201", citySlug: "saint-mathieu-de-beloeil" },
      ],
      "sainte-julie",
    );
    expect(got).toBeNull();
  });

  it("plusieurs versions dans la MÊME ville cible → retient cette ville (non ambigu)", () => {
    const got = pickLotForCity(
      [
        { canonicalId: "ogc:lots:rosemere:6717635#a", citySlug: "rosemere" },
        { canonicalId: "ogc:lots:rosemere:6717635#b", citySlug: "rosemere" },
      ],
      "rosemere",
    );
    expect(got).toBe("ogc:lots:rosemere:6717635#a");
  });
});

// ─── levenshtein ──────────────────────────────────────────────────────────────

describe("levenshtein", () => {
  it("distance 0 pour strings identiques", () => {
    expect(levenshtein("H-431", "H-431")).toBe(0);
  });

  it("distance 1 pour une substitution", () => {
    expect(levenshtein("H-431", "H-432")).toBe(1);
  });

  it("distance 1 pour une insertion", () => {
    expect(levenshtein("H431", "H-431")).toBe(1);
  });

  it("distance 1 pour une suppression", () => {
    expect(levenshtein("H-431", "H431")).toBe(1);
  });

  it("distance symétrique", () => {
    expect(levenshtein("AB-123", "A-123")).toBe(levenshtein("A-123", "AB-123"));
  });

  it("distance max(len,len) pour strings disjointes", () => {
    const a = "ABC";
    const b = "XYZ";
    expect(levenshtein(a, b)).toBe(3);
  });

  it("string vide → longueur de l'autre", () => {
    expect(levenshtein("", "H-431")).toBe(5);
    expect(levenshtein("H-431", "")).toBe(5);
  });
});

// ─── levenshteinNorm ──────────────────────────────────────────────────────────

describe("levenshteinNorm", () => {
  it("0 pour strings identiques", () => {
    expect(levenshteinNorm("H-431", "H-431")).toBe(0);
  });

  it("1 insertion sur 5 chars = 0.2", () => {
    // "H431" vs "H-431" : dist=1, max=5
    expect(levenshteinNorm("H431", "H-431")).toBeCloseTo(1 / 5);
  });

  it("0 pour deux strings vides", () => {
    expect(levenshteinNorm("", "")).toBe(0);
  });

  it("1.0 pour une string vide vs non-vide", () => {
    expect(levenshteinNorm("", "ABC")).toBe(1);
  });
});

// ─── zoneCodeVariants ─────────────────────────────────────────────────────────

describe("zoneCodeVariants", () => {
  it("code avec tiret → variante sans tiret", () => {
    const variants = zoneCodeVariants("H-431");
    expect(variants).toContain("H431");
  });

  it("code sans tiret → variante avec tiret inséré (symétrie cadastre)", () => {
    // "H431" → "H-431" : la couche cadastrale stocke souvent le code compacté
    // ("C 18" → "C18") alors que l'odonyme source est tireté ("C-18").
    const variants = zoneCodeVariants("H431");
    expect(variants).toContain("H-431");
  });

  it("C18 ↔ C-18 (cas rosemere) : insertion de tiret lettre↔chiffre", () => {
    expect(zoneCodeVariants("C18")).toContain("C-18");
    expect(zoneCodeVariants("C-18")).toContain("C18");
  });

  it("code avec préfixe lettre unique → variante sans préfixe", () => {
    // "ZH-431" → "H-431"
    const variants = zoneCodeVariants("ZH-431");
    expect(variants).toContain("H-431");
  });

  it("code avec zéros de padding → variante dépaddée", () => {
    // "H-0431" → "H-431"
    const variants = zoneCodeVariants("H-0431");
    expect(variants).toContain("H-431");
  });

  it("code lettre+chiffres compact → variante tiret (A1336 → A-1336)", () => {
    const variants = zoneCodeVariants("A1336");
    expect(variants).toContain("A-1336");
  });
});

// ─── matchZoneMultiLevel ──────────────────────────────────────────────────────

/** Mock GeoMatchDb pour les tests de matchZoneMultiLevel */
function makeDb(opts: {
  exactResult?: string | null;
  variantsResult?: string | null;
  listResult?: { canonicalId: string; codeNorm: string }[];
  allCitiesResult?: { canonicalId: string; codeNorm: string; citySlug: string }[];
}): GeoMatchDb {
  return {
    findZoneExact: async (_codeNorm, _citySlug) => opts.exactResult ?? null,
    findZoneByVariants: async (_variants, _citySlug) => opts.variantsResult ?? null,
    listZoneCodesForCity: async (_citySlug) => opts.listResult ?? [],
    findZoneAllCities: async (_codeNorm) => opts.allCitiesResult ?? [],
    findLotExact: async (_noLotNorm) => null,
    findLotCandidates: async (_noLotNorm) => [],
  };
}

describe("matchZoneMultiLevel — N1 exact", () => {
  it("N1 : exact match → MatchResult avec provenance exact_norm", async () => {
    const db = makeDb({ exactResult: "ogc:zones:mt:H-431" });
    const result = await matchZoneMultiLevel(db, "H-431", "H-431", "mont-tremblant", 0.85);
    expect(isMatchResult(result)).toBe(true);
    if (isMatchResult(result)) {
      expect(result.canonicalId).toBe("ogc:zones:mt:H-431");
      expect(result.provenance).toBe("exact_norm");
      expect(result.scoreConfiance).toBe(0.85);
    }
  });
});

describe("matchZoneMultiLevel — N2 variantes", () => {
  it("N2 : code avec tiret, DB contient variante sans tiret → provenance variant_norm, score * 0.90", async () => {
    // Extrait = "H-431" (avec tiret), DB stocke "H431" (sans tiret).
    // zoneCodeVariants("H-431") retourne ["H431"]
    // → findZoneByVariants(["H431"], citySlug) → match
    const db = makeDb({
      exactResult: null,        // pas d'exact match pour "H-431"
      variantsResult: "ogc:zones:mt:H431",  // match sur la variante "H431"
      listResult: [],
    });
    const result = await matchZoneMultiLevel(db, "H-431", "H-431", "mont-tremblant", 0.85);
    expect(isMatchResult(result)).toBe(true);
    if (isMatchResult(result)) {
      expect(result.canonicalId).toBe("ogc:zones:mt:H431");
      expect(result.provenance).toBe("variant_norm");
      expect(result.scoreConfiance).toBeCloseTo(0.85 * VARIANT_SCORE_FACTOR);
    }
  });
});

describe("matchZoneMultiLevel — N3 edit distance", () => {
  it("N3 : 1 substitution sur code 5 chars (dist=0.2 ≤ 0.25) → edit_dist", async () => {
    const db = makeDb({
      exactResult: null,
      variantsResult: null,
      listResult: [{ canonicalId: "ogc:zones:mt:H-431", codeNorm: "H-431" }],
    });
    // "H-432" vs "H-431" : dist Levenshtein=1, normalisé = 1/5 = 0.2 ≤ 0.25
    const result = await matchZoneMultiLevel(db, "H-432", "H-432", "mont-tremblant", 0.65);
    expect(isMatchResult(result)).toBe(true);
    if (isMatchResult(result)) {
      expect(result.provenance).toBe("edit_dist");
      // score = 0.65 * (1 - 0.2) * 0.85
      expect(result.scoreConfiance).toBeCloseTo(0.65 * 0.8 * EDIT_DIST_SCORE_FACTOR);
    }
  });

  it("N3 : distance > seuil → pas de match edit_dist", async () => {
    const db = makeDb({
      exactResult: null,
      variantsResult: null,
      listResult: [{ canonicalId: "ogc:zones:mt:Z-999", codeNorm: "Z-999" }],
      allCitiesResult: [],
    });
    // "H-431" vs "Z-999" : distance 4/5 = 0.8 >> 0.25
    const result = await matchZoneMultiLevel(db, "H-431", "H-431", "mont-tremblant", 0.65);
    expect(isMatchResult(result)).toBe(false);
    if (!isMatchResult(result)) {
      expect(result.raison).toBe("no_polygon");
    }
  });
});

describe("matchZoneMultiLevel — N4 city_fallback", () => {
  it("N4 : 1 seule ville étrangère → city_fallback avec score * 0.70", async () => {
    const db = makeDb({
      exactResult: null,
      variantsResult: null,
      listResult: [],
      allCitiesResult: [
        { canonicalId: "ogc:zones:rimouski:H-431", codeNorm: "H-431", citySlug: "rimouski" },
      ],
    });
    const result = await matchZoneMultiLevel(db, "H-431", "H-431", "mont-tremblant", 0.85);
    expect(isMatchResult(result)).toBe(true);
    if (isMatchResult(result)) {
      expect(result.provenance).toBe("city_fallback");
      expect(result.scoreConfiance).toBeCloseTo(0.85 * CITY_FALLBACK_SCORE_FACTOR);
    }
  });

  it("N4 : plusieurs villes étrangères → ambiguous", async () => {
    const db = makeDb({
      exactResult: null,
      variantsResult: null,
      listResult: [],
      allCitiesResult: [
        { canonicalId: "ogc:zones:rimouski:H-431", codeNorm: "H-431", citySlug: "rimouski" },
        { canonicalId: "ogc:zones:sutton:H-431", codeNorm: "H-431", citySlug: "sutton" },
      ],
    });
    const result = await matchZoneMultiLevel(db, "H-431", "H-431", "mont-tremblant", 0.85);
    expect(isMatchResult(result)).toBe(false);
    if (!isMatchResult(result)) {
      expect(result.raison).toBe("ambiguous");
    }
  });
});

describe("matchZoneMultiLevel — no_polygon", () => {
  it("aucun match N1–N4 → no_polygon", async () => {
    const db = makeDb({
      exactResult: null,
      variantsResult: null,
      listResult: [],
      allCitiesResult: [],
    });
    const result = await matchZoneMultiLevel(db, "X-999", "X-999", "sutton", 0.65);
    expect(isMatchResult(result)).toBe(false);
    if (!isMatchResult(result)) {
      expect(result.raison).toBe("no_polygon");
      expect(result.patternType).toBe("zone_code");
      expect(result.scoreConfiance).toBe(0.65);
    }
  });
});

describe("isMatchResult", () => {
  it("retourne true pour MatchResult", () => {
    expect(isMatchResult({ canonicalId: "x", scoreConfiance: 0.8, provenance: "exact_norm", extraitBrut: "H-431" })).toBe(true);
  });
  it("retourne false pour UnresolvedResult", () => {
    expect(isMatchResult({ extraitBrut: "H-431", patternType: "zone_code", scoreConfiance: 0.65, raison: "no_polygon" })).toBe(false);
  });
});

// ─── EDIT_DIST_THRESHOLD validation ──────────────────────────────────────────

describe("EDIT_DIST_THRESHOLD cohérence", () => {
  it("seuil est 0.25", () => {
    expect(EDIT_DIST_THRESHOLD).toBe(0.25);
  });

  it("1 edit sur code à 4 chars = 0.25 ≤ seuil (limite incluse)", () => {
    // "H431" (4 chars) → 1 edit → 1/4 = 0.25
    expect(levenshteinNorm("H431", "H531")).toBeCloseTo(0.25);
    expect(levenshteinNorm("H431", "H531")).toBeLessThanOrEqual(EDIT_DIST_THRESHOLD);
  });

  it("2 edits sur code à 5 chars = 0.4 > seuil (rejeté)", () => {
    // "H-431" → "H-133" : 2 substitutions → 2/5 = 0.4 > 0.25
    expect(levenshteinNorm("H-431", "H-133")).toBeGreaterThan(EDIT_DIST_THRESHOLD);
  });
});
