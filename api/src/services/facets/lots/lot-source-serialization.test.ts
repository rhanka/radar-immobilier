/**
 * 6K serialization key and writer registry: deterministic, shared, exact.
 * Synthetic keys only; no database, no operational data.
 */
import { describe, expect, it } from "vitest";
import {
  assertLotSourceWriter,
  KNOWN_LOT_SOURCE_WRITERS,
  lotSourceLockKey,
} from "./lot-source-serialization.js";

describe("6K lot source serialization", () => {
  it("should pin the canonical lock key to the facet-writer shape", () => {
    expect(lotSourceLockKey("synthetic-city", "lot-canonical-syn-01"))
      .toBe(JSON.stringify(["lot-source", "synthetic-city", "lot-canonical-syn-01"]));
  });

  it("should separate targets deterministically", () => {
    const key = lotSourceLockKey("synthetic-city", "lot-canonical-syn-01");
    expect(lotSourceLockKey("synthetic-city", "lot-canonical-syn-01")).toBe(key);
    expect(lotSourceLockKey("synthetic-city", "lot-canonical-syn-02")).not.toBe(key);
    expect(lotSourceLockKey("other-city", "lot-canonical-syn-01")).not.toBe(key);
  });

  it("should cover the three supported lot_versions writers", () => {
    expect([...KNOWN_LOT_SOURCE_WRITERS]).toEqual([
      "geo/ogc-pull",
      "geo/populate-geo",
      "exploitation/projection",
    ]);
  });

  it("should accept known writers and refuse unknown ones", () => {
    for (const writer of KNOWN_LOT_SOURCE_WRITERS) {
      expect(() => assertLotSourceWriter(writer)).not.toThrow();
    }
    expect(() => assertLotSourceWriter("geo/unknown-writer"))
      .toThrow("unknown_lot_source_writer");
  });
});
