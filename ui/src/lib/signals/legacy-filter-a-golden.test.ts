/**
 * GOLDEN — legacy Filter A (z|m|p), UI DISPLAY path. Anti-regression gate.
 *
 * Freezes the pre-3.4 HEAD projection SignauxMapView ACTUALLY renders — the
 * `projectNodesForVivierKey` / `projectLegacyVivierA` chain fed by the server
 * `legacyProjection` authority (SignauxMapView.svelte:343 and :549), NOT
 * `filterNodesBySubset` (which is dead for the A display). It pins, against a
 * deterministic corpus carrying the SERVER-issued `legacySubset` membership:
 *   - projected member set AND ORDER for every legacy subset state
 *     (z|m|p and its combinations, incl. the empty key);
 *   - the z|m|p exact-authority contract: order comes from the authority's
 *     `signalIds`, and the client revalidates the A set item-by-item;
 *   - fail-closed behaviour when the authority is absent (404 → null) or
 *     corrupt (wrong version / count / order / unknown id / over-claim);
 *   - fail-closed behaviour when a node's membership is corrupt/absent;
 *   - the empty-city case (no nodes) yielding an available, count-0 projection;
 *   - the URL-state MIGRATION now in force (the A rail is RETIRED: the fresh
 *     default and any persisted/partial legacy A key resolve to the B mode key).
 *     The A projection machinery below stays as the migration safety net; its
 *     membership/order/fail-closed contract is still frozen here.
 *
 * If any frozen membership/order/fail-closed/URL-state changes, this test FAILS
 * — a release NO-GO under
 * docs/reports/consensus/graphify-3.4-legacy-filter-a-addendum.md.
 * Do NOT regenerate the fixtures to make it pass.
 *
 * NOTE ON ORDER: the composed keys project in NODE order and z|m|p in AUTHORITY
 * (`signalIds`) order — both deterministic GIVEN their input. Neither pins the
 * database row order: `getSignalNodesForCity` (graph-store.ts:1528) has no
 * `ORDER BY`, so the end-to-end display order is not DB-guaranteed. See the HEAD
 * inventory §1.2 / §3.2.
 *
 * Pure: no Docker, no API, no Svelte component. Fixtures are committed JSON.
 */
import { describe, it, expect } from "vitest";
import type {
  GraphSignalNode,
  LegacyZmpProjection,
} from "./graph-signal-detail-client.js";
import {
  A_SUBSET_KEY,
  modeFromSubsetKey,
  subsetKeyForMode,
  aFlagsFromKey,
  keyFromAFlags,
  initialVivierSubsetKey,
  projectNodesForVivierKey,
  projectLegacyVivierA,
} from "./vivier-view-mode.js";
import nodesFixture from "./fixtures/legacy-filter-a-nodes.json";
import expectedFixture from "./fixtures/legacy-filter-a-expected.json";

const nodes = nodesFixture as unknown as GraphSignalNode[];
const expected = expectedFixture as {
  authority: LegacyZmpProjection;
  projectionMembers: Record<string, string[]>;
};
const authority = expected.authority;
const projectIds = (key: string): string[] =>
  projectNodesForVivierKey(nodes, authority, key).nodes.map((n) => n.id);

describe("legacy Filter A golden (UI display path) — projected membership & order", () => {
  for (const key of Object.keys(expected.projectionMembers)) {
    it(`subset "${key}" renders the frozen ordered members`, () => {
      expect(projectIds(key)).toEqual(expected.projectionMembers[key]);
    });
  }

  it("z|m|p is served by the exact server authority (available, revalidated)", () => {
    const projected = projectNodesForVivierKey(nodes, authority, "z|m|p");
    expect(projected.available).toBe(true);
    expect(projected.count).toBe(authority.a.count);
    expect(projected.nodes.map((n) => n.id)).toEqual(authority.a.signalIds);
    // projectLegacyVivierA is the exact node the composed path delegates to.
    expect(projectLegacyVivierA(nodes, authority).nodes.map((n) => n.id))
      .toEqual(authority.a.signalIds);
  });

  it("the display path HONORS the m axis (unlike the dead filterNodesBySubset)", () => {
    // Real path reads legacySubset.flags.m — m is NOT ignored here.
    expect(projectIds("m")).toEqual(["n1", "n5"]);
    expect(projectIds("z")).not.toEqual(projectIds("z|m"));
  });
});

describe("legacy Filter A golden (UI display path) — fail-closed on authority", () => {
  const unavailable = { available: false, count: null, nodes: [] };

  it("404 / absent authority (null) is fail-closed for z|m|p", () => {
    expect(projectNodesForVivierKey(nodes, null, "z|m|p")).toEqual(unavailable);
    // The client's own 404 shape: no nodes + null authority.
    expect(projectNodesForVivierKey([], null, "z|m|p")).toEqual(unavailable);
  });

  it("a wrong-version authority is rejected", () => {
    const bad = { version: "legacy-zmp-v2", a: authority.a };
    expect(projectNodesForVivierKey(nodes, bad, "z|m|p")).toEqual(unavailable);
  });

  it("a count / signalIds length mismatch is rejected", () => {
    const bad = { version: "legacy-zmp-v1", a: { count: 3, signalIds: ["n1", "n5"] } };
    expect(projectNodesForVivierKey(nodes, bad, "z|m|p")).toEqual(unavailable);
  });

  it("duplicate authority ids are rejected", () => {
    const bad = { version: "legacy-zmp-v1", a: { count: 2, signalIds: ["n1", "n1"] } };
    expect(projectNodesForVivierKey(nodes, bad, "z|m|p")).toEqual(unavailable);
  });

  it("a WRONG-ORDER authority is fail-closed (order is contractual)", () => {
    const bad = { version: "legacy-zmp-v1", a: { count: 2, signalIds: ["n5", "n1"] } };
    expect(projectNodesForVivierKey(nodes, bad, "z|m|p")).toEqual(unavailable);
  });

  it("an authority naming an unknown id is rejected", () => {
    const bad = { version: "legacy-zmp-v1", a: { count: 2, signalIds: ["n1", "n9"] } };
    expect(projectNodesForVivierKey(nodes, bad, "z|m|p")).toEqual(unavailable);
  });

  it("an authority that OVER-claims the A set is rejected", () => {
    const bad = { version: "legacy-zmp-v1", a: { count: 3, signalIds: ["n1", "n4", "n5"] } };
    expect(projectNodesForVivierKey(nodes, bad, "z|m|p")).toEqual(unavailable);
  });
});

describe("legacy Filter A golden (UI display path) — fail-closed on node membership", () => {
  const unavailable = { available: false, count: null, nodes: [] };

  it("a node whose legacySubset.signalId disagrees with id is fail-closed", () => {
    const corrupt = nodes.map((n, i) =>
      i === 0 ? { ...n, legacySubset: { ...n.legacySubset!, signalId: "mismatch" } } : n,
    ) as GraphSignalNode[];
    expect(projectNodesForVivierKey(corrupt, authority, "z|m|p")).toEqual(unavailable);
    // A composed key is equally fail-closed on corrupt membership.
    expect(projectNodesForVivierKey(corrupt, authority, "z")).toEqual(unavailable);
  });

  it("a node missing legacySubset entirely is fail-closed", () => {
    const [, ...rest] = nodes;
    const missing = [{ ...nodes[0]!, legacySubset: undefined }, ...rest] as GraphSignalNode[];
    expect(projectNodesForVivierKey(missing, authority, "z|m|p")).toEqual(unavailable);
  });
});

describe("legacy Filter A golden (UI display path) — empty-city case", () => {
  it("no nodes + matching empty authority is available and count 0", () => {
    const emptyAuthority = { version: "legacy-zmp-v1", a: { count: 0, signalIds: [] } };
    expect(projectNodesForVivierKey([], emptyAuthority, "z|m|p")).toEqual({
      available: true,
      count: 0,
      nodes: [],
    });
  });
});

describe("legacy Filter A golden (UI display path) — URL-state normalization", () => {
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

  it("initial subset migrates the default and any legacy A key to B (A rail retired)", () => {
    // The A rail is retired: a fresh default lands on B, never the old z|m|p.
    expect(initialVivierSubsetKey(null, null)).toBe("vivier-v2");
    // A stored legacy A key (partial or full) migrates to B — never a blank rail.
    expect(initialVivierSubsetKey(null, "z|p")).toBe("vivier-v2");
    expect(initialVivierSubsetKey(null, A_SUBSET_KEY)).toBe("vivier-v2");
    // A stored B mode key is preserved as the B default.
    expect(initialVivierSubsetKey(null, "vivier-v2")).toBe("vivier-v2");
  });
});
