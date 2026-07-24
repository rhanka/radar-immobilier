/**
 * GOLDEN — legacy Filter A (z|m|p), UI layer. Anti-regression gate.
 *
 * Freezes the pre-3.4 HEAD client behaviour of the unfiltered legacy A
 * presentation against a deterministic node corpus carrying the SERVER-issued
 * `legacySubset` membership (exactly what the API attaches per node):
 *   - filterNodesBySubset membership & ORDER for every legacy subset state
 *     (""/z/m/p and their combinations) + an unknown-flag URL state;
 *   - the empty-key identity contract (same array reference — the UI must not
 *     reorder or clone the legacy projection);
 *   - the ignored legacy `m` axis (client-side unknown flag → no member lost);
 *   - the URL-state normalization the addendum requires (default A = z|m|p and
 *     invalid/partial legacy keys collapse to the A mode default).
 *
 * If any frozen membership/order/URL-state changes, this test FAILS — a release
 * NO-GO under docs/reports/consensus/graphify-3.4-legacy-filter-a-addendum.md.
 * Do NOT regenerate the fixtures to make it pass.
 *
 * Pure: no Docker, no API, no Svelte component. Fixtures are committed JSON.
 */
import { describe, it, expect } from "vitest";
import type { GraphSignalNode } from "./graph-signal-detail-client.js";
import { filterNodesBySubset, nodeMatchesSubset } from "./graph-signal-filter.js";
import {
  A_SUBSET_KEY,
  modeFromSubsetKey,
  subsetKeyForMode,
  aFlagsFromKey,
  keyFromAFlags,
  initialVivierSubsetKey,
} from "./vivier-view-mode.js";
import nodesFixture from "./fixtures/legacy-filter-a-nodes.json";
import expectedFixture from "./fixtures/legacy-filter-a-expected.json";

const nodes = nodesFixture as unknown as GraphSignalNode[];
const expected = expectedFixture as { filterMembers: Record<string, string[]> };

describe("legacy Filter A golden (UI) — filterNodesBySubset membership & order", () => {
  for (const key of Object.keys(expected.filterMembers)) {
    it(`subset "${key}" keeps the frozen ordered members`, () => {
      const ids = filterNodesBySubset(nodes, key).map((n) => n.id);
      expect(ids).toEqual(expected.filterMembers[key]);
    });
  }

  it("nodeMatchesSubset agrees with filterNodesBySubset for z|m|p", () => {
    const viaMatch = nodes.filter((n) => nodeMatchesSubset(n, "z|m|p")).map((n) => n.id);
    expect(viaMatch).toEqual(expected.filterMembers["z|m|p"]);
  });
});

describe("legacy Filter A golden (UI) — identity & ignored-m contracts", () => {
  it('key="" returns the SAME array reference (no reorder/clone)', () => {
    expect(filterNodesBySubset(nodes, "")).toBe(nodes);
  });

  it('legacy "m" is an ignored client flag: no member is lost vs ""', () => {
    expect(filterNodesBySubset(nodes, "m").map((n) => n.id))
      .toEqual(expected.filterMembers[""]);
  });

  it("empty node list yields empty membership for any key", () => {
    expect(filterNodesBySubset([], "z|m|p")).toEqual([]);
    expect(filterNodesBySubset([], "z")).toEqual([]);
  });
});

describe("legacy Filter A golden (UI) — URL-state normalization", () => {
  it("default A mode key is z|m|p", () => {
    expect(A_SUBSET_KEY).toBe("z|m|p");
    expect(subsetKeyForMode("a")).toBe("z|m|p");
  });

  it("all z/m/p vocabulary (incl. empty and partial) stays mode A", () => {
    for (const key of ["z|m|p", "", "z|p", "m", "p", "z"]) {
      expect(modeFromSubsetKey(key)).toBe("a");
    }
  });

  it("only the opaque vivier-v2 namespace flips to mode B", () => {
    expect(modeFromSubsetKey("vivier-v2")).toBe("b");
    expect(modeFromSubsetKey("vivier-v2|p")).toBe("b");
  });

  it("A flag <-> key round-trips canonically (z|m|p order)", () => {
    expect(keyFromAFlags(aFlagsFromKey("z|m|p"))).toBe("z|m|p");
    expect(aFlagsFromKey("z|p")).toEqual({ z: true, m: false, p: true });
    expect(keyFromAFlags({ z: true, m: false, p: true })).toBe("z|p");
    expect(keyFromAFlags({ z: false, m: false, p: false })).toBe("");
  });

  it("initial subset defaults to z|m|p and normalizes a partial legacy key to the A default", () => {
    expect(initialVivierSubsetKey(null, null)).toBe("z|m|p");
    // A stored partial legacy key is not sticky — it collapses to the A mode key.
    expect(initialVivierSubsetKey(null, "z|p")).toBe("z|m|p");
    // A stored B mode key is preserved as the B default.
    expect(initialVivierSubsetKey(null, "vivier-v2")).toBe("vivier-v2");
  });
});
