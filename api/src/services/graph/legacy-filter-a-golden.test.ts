/**
 * GOLDEN — legacy Filter A (z|m|p), SERVER layer. Anti-regression gate.
 *
 * Freezes the pre-3.4 HEAD behaviour of the server-authoritative legacy A
 * predicates and counters against a deterministic corpus:
 *   - per-signal z|m|p membership  (classifyLegacyZmpSignal ∘ extractLegacyZmpInput)
 *   - per-city legacy subset counts (computeLegacySubsetCounts) — all 8 z|m|p keys
 *   - per-city A projection & order (buildLegacyZmpProjection)
 *   - parity: aggregateGraphSignalProjectionRows re-exposes the SAME 8 legacy
 *     keys (so the rail wiring cannot silently diverge from the legacy fn)
 *   - empty-input states
 *
 * If ANY of these frozen values changes, this test FAILS. Per the Filter A
 * addendum that is a release NO-GO: the legacy z|m|p member set, counters, and
 * order must remain exactly as they are at HEAD. Do NOT "update the golden" to
 * make it pass — a divergence is the signal, not a chore.
 *
 * Pure: no Docker, no DB, no S3, no network. Fixtures are read from disk.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  aggregateGraphSignalProjectionRows,
  type GraphSignalProjectionRow,
} from "./graph-store.js";
import {
  classifyLegacyZmpSignal,
  extractLegacyZmpInput,
  computeLegacySubsetCounts,
  buildLegacyZmpProjection,
  type LegacySubsetKey,
  type LegacyZmpMembership,
} from "./vivier-v2.js";

function readFixture<T>(name: string): T {
  const url = new URL(`../../../tests/fixtures/graphify/legacy-filter-a/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as T;
}

const rows = readFixture<GraphSignalProjectionRow[]>("rows.json");

interface ExpectedFixture {
  memberships: Record<string, { z: boolean; m: boolean; p: boolean }>;
  cities: Record<string, {
    subsetCounts: Record<LegacySubsetKey, number>;
    aProjectionIds: string[];
  }>;
}
const expected = readFixture<ExpectedFixture>("expected.json");

const LEGACY_KEYS: readonly LegacySubsetKey[] = [
  "", "z", "m", "p", "z|m", "z|p", "m|p", "z|m|p",
];

function rowsForCity(city: string): GraphSignalProjectionRow[] {
  return rows.filter((r) => r.citySlug === city);
}
function membershipsForCity(city: string): LegacyZmpMembership[] {
  return rowsForCity(city).map((r) => classifyLegacyZmpSignal(extractLegacyZmpInput(r)));
}

describe("legacy Filter A golden — per-signal z|m|p membership", () => {
  it("matches the frozen membership map exactly", () => {
    const actual: Record<string, { z: boolean; m: boolean; p: boolean }> = {};
    for (const row of rows) {
      actual[row.id] = classifyLegacyZmpSignal(extractLegacyZmpInput(row)).flags;
    }
    expect(actual).toEqual(expected.memberships);
  });
});

describe("legacy Filter A golden — per-city subset counts & projection", () => {
  for (const [city, cityExpected] of Object.entries(expected.cities)) {
    it(`${city}: computeLegacySubsetCounts matches the frozen 8 legacy keys`, () => {
      const counts = computeLegacySubsetCounts(
        rowsForCity(city).map(extractLegacyZmpInput),
      );
      for (const key of LEGACY_KEYS) {
        expect(counts[key]).toBe(cityExpected.subsetCounts[key]);
      }
    });

    it(`${city}: buildLegacyZmpProjection yields the frozen A ids IN ORDER`, () => {
      const projection = buildLegacyZmpProjection(membershipsForCity(city));
      expect(projection.a.signalIds).toEqual(cityExpected.aProjectionIds);
      // Human invariant: A count == A ids length == the z|m|p subset count.
      expect(projection.a.count).toBe(cityExpected.aProjectionIds.length);
      expect(projection.a.count).toBe(cityExpected.subsetCounts["z|m|p"]);
    });
  }
});

describe("legacy Filter A golden — rail wiring parity", () => {
  it("aggregateGraphSignalProjectionRows re-exposes the SAME 8 legacy keys per city", () => {
    const aggregated = aggregateGraphSignalProjectionRows(rows);
    for (const [city, cityExpected] of Object.entries(expected.cities)) {
      const entry = aggregated.find((c) => c.citySlug === city);
      expect(entry, `city ${city} present in aggregate`).toBeDefined();
      for (const key of LEGACY_KEYS) {
        expect(entry!.subsetCounts[key]).toBe(cityExpected.subsetCounts[key]);
      }
    }
  });
});

describe("legacy Filter A golden — empty / edge states", () => {
  it("empty membership yields all-zero legacy counts", () => {
    const counts = computeLegacySubsetCounts([]);
    for (const key of LEGACY_KEYS) expect(counts[key]).toBe(0);
  });

  it("empty membership yields an empty A projection", () => {
    const projection = buildLegacyZmpProjection([]);
    expect(projection.a.count).toBe(0);
    expect(projection.a.signalIds).toEqual([]);
  });

  it("empty rows yield no city entries in the aggregate", () => {
    expect(aggregateGraphSignalProjectionRows([])).toEqual([]);
  });
});
