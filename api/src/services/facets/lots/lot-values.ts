/**
 * 6J lot business value validation: price and listing link.
 *
 * `set_market` is a complete replacement of the market value: both fields
 * are required, `null` explicitly clears, omission is rejected. Prices are
 * validated as exact decimal text over NUMERIC(14,2) without any
 * floating-point round-trip; persistence must carry the text through.
 */
import { FacetError } from "../target.js";

const MAX_URL_LENGTH = 2048;
const MIN_PRICE = "000000000000.01";
const MAX_PRICE = "999999999999.99";

export type PipelineStatus = "sollicite" | "lettre_envoyee";

export function assertPipelineStatus(value: unknown): asserts value is PipelineStatus {
  if (value !== "sollicite" && value !== "lettre_envoyee") {
    throw new FacetError(422, "invalid_business_value");
  }
}

/** Canonical decimal text: no leading zeros, exactly two fraction digits. */
export function normalizeAskingPrice(value: string | null): string | null {
  if (value === null) return null;
  assertAskingPrice(value);
  const [whole = "", fraction = ""] = value.split(".");
  const digits = whole.replace(/^0+(?=\d)/, "");
  return `${digits}.${(fraction + "00").slice(0, 2)}`;
}

/** Canonical decimal text: 0.01–999999999999.99, at most two fraction digits. */
export function assertAskingPrice(value: unknown): asserts value is string | null {
  if (value === null) return;
  if (typeof value !== "string" || !/^\d{1,12}(\.\d{1,2})?$/.test(value)) {
    throw new FacetError(422, "invalid_business_value");
  }
  const [whole = "", fraction = ""] = value.split(".");
  const padded = `${whole.padStart(12, "0")}.${(fraction + "00").slice(0, 2)}`;
  if (padded < MIN_PRICE || padded > MAX_PRICE) {
    throw new FacetError(422, "invalid_business_value");
  }
}

/** Public HTTP(S) listing URL contract: no credentials, no whitespace. */
export function assertListingUrl(value: unknown): asserts value is string | null {
  if (value === null) return;
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_URL_LENGTH
    || (value.startsWith("http://") === false && value.startsWith("https://") === false)
    || /\s/.test(value)) {
    throw new FacetError(422, "invalid_business_value");
  }
  try {
    const url = new URL(value);
    if (url.hostname === "" || url.username !== "" || url.password !== "") {
      throw new FacetError(422, "invalid_business_value");
    }
  } catch (error) {
    if (error instanceof FacetError) throw error;
    throw new FacetError(422, "invalid_business_value");
  }
}

export interface MarketValue {
  asking_price: string | null;
  listing_url: string | null;
}

/** Both fields required (null clears); omission or extras are rejected upstream by zod strict(). */
export function assertMarketValue(value: { asking_price: unknown; listing_url: unknown }): MarketValue {
  assertAskingPrice(value.asking_price);
  assertListingUrl(value.listing_url);
  return { asking_price: value.asking_price, listing_url: value.listing_url };
}
