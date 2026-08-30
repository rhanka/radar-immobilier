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

  it("retire les suffixes secteur parenthésés (XX)", () => {
    expect(normalizeZoneCode("H34-327 (VLO)")).toBe("H34-327");
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

  it("dérivée de la canonique (parens retirés d'abord, casse normalisée)", () => {
    expect(zoneSearchKey("h-101 (VLO)")).toBe("H101");
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
