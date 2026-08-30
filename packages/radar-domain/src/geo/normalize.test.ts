import { describe, it, expect } from "vitest";

import { normalizeZoneCode, zoneSearchKey, normalizeLotKey } from "./normalize.js";

// Contrat de convergence lots-zones (§3/P04, ratifié i-arch/geo-zones).
// Une seule impl déterministe partagée api+ui — les golden figent le contrat.

describe("normalizeZoneCode — IDENTITÉ zone (hyphen-preserving)", () => {
  it("préserve les tirets (H-431 ≠ H431)", () => {
    expect(normalizeZoneCode("H-431")).toBe("H-431");
  });

  it("distingue le multi-segment (HOLD geo-zones : H-10-1 ≠ H-101)", () => {
    expect(normalizeZoneCode("H-10-1")).toBe("H-10-1");
    expect(normalizeZoneCode("H-101")).toBe("H-101");
    expect(normalizeZoneCode("H-10-1")).not.toBe(normalizeZoneCode("H-101"));
  });

  it("majuscule + compacte les espaces", () => {
    expect(normalizeZoneCode("h 34-327")).toBe("H34-327");
  });

  it("tirets unicode (– —) → tiret ASCII", () => {
    expect(normalizeZoneCode("H–431")).toBe("H-431");
    expect(normalizeZoneCode("H—431")).toBe("H-431");
  });

  it("suffixe secteur : parenthèses retirées, CONTENU conservé (distingueur — corpus 29a14334)", () => {
    expect(normalizeZoneCode("H34-327 (VLO)")).toBe("H34-327VLO");
    // Le suffixe DISTINGUE des zones réelles → ne PAS blanket-stripper (non injectif).
    expect(normalizeZoneCode("02 (AGF)")).not.toBe(normalizeZoneCode("02 (RCT)"));
  });

  it("null / undefined → \"\"", () => {
    expect(normalizeZoneCode(null)).toBe("");
    expect(normalizeZoneCode(undefined)).toBe("");
  });
});

describe("zoneSearchKey — RECHERCHE zone (strip-all, dérivée de la canonique)", () => {
  it("tolérance de saisie owner : H101 ≡ H-101", () => {
    expect(zoneSearchKey("H-101")).toBe("H101");
    expect(zoneSearchKey("H101")).toBe("H101");
    expect(zoneSearchKey("H-101")).toBe(zoneSearchKey("H101"));
  });

  it("dérivée de la canonique (casse normalisée, contenu suffixe en alnum)", () => {
    expect(zoneSearchKey("h-101 (VLO)")).toBe("H101VLO");
  });

  it("multi-segment : sur-match assumé en recherche (départagé par candidats+verbatim côté UI)", () => {
    // H-10-1 et H-101 partagent la searchKey — l'identité (normalizeZoneCode) reste distincte.
    expect(zoneSearchKey("H-10-1")).toBe(zoneSearchKey("H-101"));
    expect(normalizeZoneCode("H-10-1")).not.toBe(normalizeZoneCode("H-101"));
  });

  it("null → \"\"", () => {
    expect(zoneSearchKey(null)).toBe("");
  });
});

describe("normalizeLotKey — lot cadastral (digits-only, défensif)", () => {
  it("retire les séparateurs → séquence de digits", () => {
    expect(normalizeLotKey("6 377 154")).toBe("6377154");
    expect(normalizeLotKey("6377154")).toBe("6377154");
    expect(normalizeLotKey("6.057.912")).toBe("6057912");
  });

  it("2 lots distincts restent distincts (pas de faux-merge)", () => {
    expect(normalizeLotKey("6377154")).not.toBe(normalizeLotKey("6377155"));
  });

  it("null / undefined → \"\"", () => {
    expect(normalizeLotKey(null)).toBe("");
    expect(normalizeLotKey(undefined)).toBe("");
  });
});

// ── Régression corpus 8d3d8b9b (geo-zones — 873 munis de zonage SERVIS) ──────
// Codes bruts DISTINCTS mesurés en collision sur la couche servie : un norm()
// naïf strip-all les fusionnerait à tort. normalizeZoneCode (IDENTITÉ) DOIT les
// garder distincts. Source autoritaire : geo lane/zones
// work/coverage/zones-zonecode-norm-collision-20260825.{json,md}.
describe("normalizeZoneCode — régression corpus 8d3d8b9b (munis HARMFUL : ne PAS fusionner)", () => {
  const harmful: Array<[string, string, string]> = [
    ["H-103-1", "H-1031", "drummondville"],
    ["C1-8", "C18", "lanoraie"],
    ["R1-6", "R16", "lanoraie"],
    ["HA-1-2", "HA-12", "franklin"],
    ["Af-1-1", "Af-11", "hinchinbrooke"],
    ["C-1-1", "C-11", "mont-saint-hilaire"],
    ["A1-1", "A11", "saint-ambroise-de-kildare"],
    ["A2-1", "A21", "saint-ambroise-de-kildare"],
    ["Ra1-1", "Ra11", "sainte-clotilde"],
    ["Ra1-3", "Ra13", "sainte-clotilde"],
    ["Ra-1-4", "Ra14", "sainte-clotilde"],
    ["Ra1-6", "Ra16", "sainte-clotilde"],
    ["H-1.3", "H-13", "saint-joseph-de-beauce"],
    ["H-1.4", "H-14", "saint-joseph-de-beauce"],
    ["3.1-H", "31-H", "saint-narcisse-de-beaurivage"],
    ["5.1 R", "51 R", "amqui"],
    ["P-1", "P1", "ascot-corner"],
    ["RU*-65", "RU-65", "cote-saint-luc"],
    ["A-01", "A-Î01", "saint-aime-du-lac-des-iles"],
    ["A-02", "A-Î02", "saint-aime-du-lac-des-iles"],
    ["01 (AGF)", "01 AGF)", "saint-donat / saint-joseph-de-lepage"],
    // Suffixe secteur parenthésé = distingueur (geo-zones 29a14334) : le blanket-strip
    // fusionnait à tort ces zones distinctes → contenu du suffixe conservé.
    ["02 (AGF)", "02 (RCT)", "la-redemption"],
    ["34 (CSV)", "34 (HBF)", "la-redemption"],
    ["35 (AGF)", "35 (MTF)", "padoue"],
    ["01 (AGF)", "01 (FRT)", "saint-donat--la-mitis"],
    ["02 (AGC)", "02 (AGF)", "saint-donat--la-mitis"],
    ["02 (AGC)", "02 (VLG)", "saint-joseph-de-lepage"],
  ];
  for (const [a, b, muni] of harmful) {
    it(`${muni} : "${a}" ≠ "${b}"`, () => {
      expect(normalizeZoneCode(a)).not.toBe(normalizeZoneCode(b));
    });
  }
});

// MAY-SAFELY-MERGE : la couche RECHERCHE fusionne (recall) ; l'identité départage
// ensuite via l'ensemble des candidats raw verbatim côté UI (design i-arch).
describe("zoneSearchKey — régression corpus 8d3d8b9b (recall : fusion sûre)", () => {
  const mayMerge: Array<[string, string]> = [
    ["H-101", "H101"],
    ["A-1", "A1"],
    ["Inst1", "INST1"],
    ["Rc8", "RC8"],
    ["74 - ZR", "74-ZR"],
  ];
  for (const [a, b] of mayMerge) {
    it(`"${a}" ≡ "${b}" en recherche`, () => {
      expect(zoneSearchKey(a)).toBe(zoneSearchKey(b));
      expect(zoneSearchKey(a)).not.toBe("");
    });
  }
});
