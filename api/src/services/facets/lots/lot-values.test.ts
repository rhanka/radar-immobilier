/**
 * 6J business values: exact decimal prices and public listing URLs.
 * Synthetic values only; persistence must carry the exact decimal text.
 */
import { describe, expect, it } from "vitest";
import {
  assertAskingPrice,
  assertListingUrl,
  assertMarketValue,
  assertPipelineStatus,
  normalizeAskingPrice,
} from "./lot-values.js";

describe("6J lot business values", () => {
  it("should accept the canonical decimal boundaries and reject the rest", () => {
    expect(() => assertAskingPrice(null)).not.toThrow();
    for (const price of ["0.01", "10", "10.5", "10.00", "999999999999.99", "000000000001.00"]) {
      expect(() => assertAskingPrice(price)).not.toThrow();
    }
    for (const price of ["0", "0.00", "-1", "10.123", "1,000.00", "1e3", "", 10, 10.5,
      "1000000000000.00", "999999999999.999", "NaN", " 10.00"]) {
      expect(() => assertAskingPrice(price as unknown as string)).toThrow("invalid_business_value");
    }
  });

  it("should canonicalize accepted spellings without floating point", () => {
    expect(normalizeAskingPrice(null)).toBeNull();
    expect(normalizeAskingPrice("10")).toBe("10.00");
    expect(normalizeAskingPrice("10.5")).toBe("10.50");
    expect(normalizeAskingPrice("0010.0")).toBe("10.00");
    expect(normalizeAskingPrice("000000000001.00")).toBe("1.00");
    expect(normalizeAskingPrice("999999999999.99")).toBe("999999999999.99");
    expect(() => normalizeAskingPrice("10.123")).toThrow("invalid_business_value");
  });

  it("should never round-trip prices through floating point", () => {
    // "10.10" parsed as a float and back would read "10.1"; the contract
    // keeps the exact text for persistence.
    expect(Number("10.10").toString()).toBe("10.1");
    expect(() => assertAskingPrice("10.10")).not.toThrow();
  });

  it("should accept public HTTP(S) listing URLs and reject the rest", () => {
    expect(() => assertListingUrl(null)).not.toThrow();
    expect(() => assertListingUrl("https://synthetic.invalid/annonce/1")).not.toThrow();
    expect(() => assertListingUrl("http://synthetic.invalid/a?x=%2F")).not.toThrow();
    for (const url of ["", "ftp://synthetic.invalid/a", "synthetic.invalid/a",
      "https://synthetic.invalid/a b", "https://user@synthetic.invalid/a",
      "https://user:pass@synthetic.invalid/a", "https://", "http://",
      `https://synthetic.invalid/${"a".repeat(2048)}`]) {
      expect(() => assertListingUrl(url)).toThrow("invalid_business_value");
    }
  });

  it("should require both market fields together", () => {
    expect(assertMarketValue({ asking_price: "10.00", listing_url: null })).toEqual({
      asking_price: "10.00", listing_url: null,
    });
    expect(() => assertMarketValue({ asking_price: "0.00", listing_url: null }))
      .toThrow("invalid_business_value");
  });

  it("should accept only the two pipeline statuses", () => {
    expect(() => assertPipelineStatus("sollicite")).not.toThrow();
    expect(() => assertPipelineStatus("lettre_envoyee")).not.toThrow();
    expect(() => assertPipelineStatus("en_vente")).toThrow("invalid_business_value");
    expect(() => assertPipelineStatus(null)).toThrow("invalid_business_value");
  });
});
