import { describe, expect, it } from "vitest";
import {
  NORMATIVE_VALUE_KEYS,
  REGLEMENT_KEYS,
  hasRecognizedValue,
  normalizeNormValue,
} from "./normes-keys.js";

describe("normes-keys", () => {
  it("recognizes the sourced regulation and normative fields", () => {
    expect(REGLEMENT_KEYS).toContain("reglement_url");
    expect(REGLEMENT_KEYS).toContain("reglement_numero");
    expect(NORMATIVE_VALUE_KEYS).toContain("densite_value");
    expect(NORMATIVE_VALUE_KEYS).toContain("hauteur_min_value");
  });

  it("normalizes scalar and array evidence without inventing values", () => {
    expect(normalizeNormValue(" 35,5 ")).toBe(35.5);
    expect(normalizeNormValue([null, " 12 "])).toBe(12);
    expect(normalizeNormValue("R-901")).toBe("R-901");
    expect(normalizeNormValue(0)).toBe(0);

    for (const value of [null, undefined, " ", false, {}, Number.NaN]) {
      expect(normalizeNormValue(value)).toBeNull();
    }
  });

  it("only accepts non-empty values on allowlisted keys", () => {
    expect(
      hasRecognizedValue(
        { reglement_url: "https://example.test/r-901.pdf" },
        REGLEMENT_KEYS,
      ),
    ).toBe(true);
    expect(
      hasRecognizedValue({ densite_value: [null, "35"] }, NORMATIVE_VALUE_KEYS),
    ).toBe(true);
    expect(
      hasRecognizedValue({ reglement_url: " ", other: "35" }, REGLEMENT_KEYS),
    ).toBe(false);
  });
});
