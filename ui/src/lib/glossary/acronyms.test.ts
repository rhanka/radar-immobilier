import { describe, it, expect } from "vitest";
import { ACRONYMS, getAcronym } from "./acronyms.js";

describe("ACRONYMS", () => {
  it("covers all required domain acronyms", () => {
    const required = [
      "CPTAQ",
      "PPCMOI",
      "PIIA",
      "BDZI",
      "GRHQ",
      "LPTA",
      "PPRLPI",
      "COS",
      "OACIQ",
      "MRC",
      "PADTC",
    ];
    for (const term of required) {
      expect(ACRONYMS[term], `missing acronym: ${term}`).toBeDefined();
    }
  });

  it("each entry has non-empty term, full and definition", () => {
    for (const [key, entry] of Object.entries(ACRONYMS)) {
      expect(entry.term.length, `${key}.term is empty`).toBeGreaterThan(0);
      expect(entry.full.length, `${key}.full is empty`).toBeGreaterThan(0);
      expect(
        entry.definition.length,
        `${key}.definition is empty`
      ).toBeGreaterThan(0);
    }
  });

  it("entries with url have a valid-looking URL", () => {
    for (const [key, entry] of Object.entries(ACRONYMS)) {
      if (entry.url !== undefined) {
        expect(
          entry.url.startsWith("https://"),
          `${key}.url does not start with https://`
        ).toBe(true);
      }
    }
  });

  it("has no em-dash in any field", () => {
    for (const [key, entry] of Object.entries(ACRONYMS)) {
      for (const field of ["full", "definition"] as const) {
        expect(
          entry[field].includes("—"),
          `${key}.${field} contains em-dash`
        ).toBe(false);
      }
    }
  });
});

describe("getAcronym", () => {
  it("returns correct entry for exact uppercase key", () => {
    const entry = getAcronym("CPTAQ");
    expect(entry).toBeDefined();
    expect(entry?.term).toBe("CPTAQ");
  });

  it("is case-insensitive", () => {
    expect(getAcronym("cptaq")).toBeDefined();
    expect(getAcronym("Cptaq")).toBeDefined();
    expect(getAcronym("MRC")).toBeDefined();
    expect(getAcronym("mrc")).toBeDefined();
  });

  it("handles Loi 25 case-insensitively", () => {
    expect(getAcronym("Loi 25")).toBeDefined();
    expect(getAcronym("LOI 25")).toBeDefined();
    expect(getAcronym("loi 25")).toBeDefined();
  });

  it("returns undefined for unknown terms", () => {
    expect(getAcronym("FOOBAR")).toBeUndefined();
    expect(getAcronym("")).toBeUndefined();
    expect(getAcronym("   ")).toBeUndefined();
  });

  it("trims whitespace around term", () => {
    expect(getAcronym("  CPTAQ  ")).toBeDefined();
  });

  it("at least 12 entries total (required list + Loi 25)", () => {
    expect(Object.keys(ACRONYMS).length).toBeGreaterThanOrEqual(12);
  });
});
