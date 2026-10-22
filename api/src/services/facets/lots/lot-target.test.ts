/**
 * 6J lot target identity: stable target, versioned fingerprint.
 * Synthetic rows only; no database, no operational data.
 */
import { describe, expect, it } from "vitest";
import {
  canonicalLotTarget,
  lotFingerprint,
  toLotTarget,
} from "./lot-target.js";

function syntheticRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "6a000000-0000-4000-8000-000000000001",
    canonicalId: "lot-canonical-syn-6j-01",
    noLot: "SYN-6J-0001",
    citySlug: "synthetic-6j-city",
    noLotNorm: "SYN6J0001",
    reconStatus: "validated",
    reconPatchId: null,
    validFrom: "2025-01-01",
    validTo: null,
    knownFrom: new Date("2025-01-01T00:00:00.000Z"),
    knownTo: null,
    geom: null,
    geomSource: "none",
    geomFetchedAt: null,
    rawRef: "synthetic-6j",
    evidence: [],
    ...overrides,
  } as unknown as Parameters<typeof lotFingerprint>[0];
}

describe("6J lot target identity", () => {
  it("should fingerprint the stored source fields deterministically", () => {
    expect(lotFingerprint(syntheticRow())).toBe(lotFingerprint(syntheticRow()));
    expect(lotFingerprint(syntheticRow())).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should detect changed content under the same version UUID", () => {
    const before = lotFingerprint(syntheticRow());
    expect(lotFingerprint(syntheticRow({ rawRef: "synthetic-6j-revised" }))).not.toBe(before);
    expect(lotFingerprint(syntheticRow({ geomSource: "cadastre" }))).not.toBe(before);
    expect(lotFingerprint(syntheticRow({ reconStatus: "pending" }))).not.toBe(before);
  });

  it("should accept equivalent known-from representations", () => {
    const date = lotFingerprint(syntheticRow());
    const text = lotFingerprint(syntheticRow({ knownFrom: "2025-01-01T00:00:00.000Z" }));
    expect(text).toBe(date);
  });

  it("should key the stable target on city and canonical id only", () => {
    expect(toLotTarget({ citySlug: "ville-a", canonicalId: "LOT-1" })).toEqual({
      type: "Lot", authority: "lot_versions", citySlug: "ville-a", canonicalId: "LOT-1",
    });
    expect(canonicalLotTarget(toLotTarget({ citySlug: "ville-a", canonicalId: "LOT-1" })))
      .toBe(canonicalLotTarget(toLotTarget({ citySlug: "ville-a", canonicalId: "LOT-1" })));
    expect(canonicalLotTarget(toLotTarget({ citySlug: "ville-a", canonicalId: "LOT-1" })))
      .not.toBe(canonicalLotTarget(toLotTarget({ citySlug: "ville-a", canonicalId: "LOT-2" })));
  });
});
