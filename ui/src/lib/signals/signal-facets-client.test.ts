/**
 * Tests for the signal-facets client (lot 4, C1).
 *
 * Synthetic taxonomy only: the profile below deliberately gives codes whose
 * PREFIX contradicts their verdict, proving the UI filters on the exact
 * verdict and never on the prefix.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFacetTarget, codesForVerdict } from "./signal-facets-client.js";
import type { GraphSignalNode } from "./graph-signal-detail-client.js";

function signalNode(overrides: Partial<GraphSignalNode> = {}): GraphSignalNode {
  return {
    id: "sig-1",
    type: "Signal",
    label: "Synthetic signal",
    citySlug: "ville-synth",
    sourceRef: null,
    createdAt: null,
    props: {},
    ...overrides,
  };
}

/** Prefix contradicts verdict on purpose: filtering must follow verdict. */
const CODES = [
  { code: "P-DENSITE", verdict: "pertinent" },
  { code: "P-BIDON", verdict: "non_pertinent" },
  { code: "N-ADMIN", verdict: "non_pertinent" },
  { code: "N-LEURRE", verdict: "a_surveiller" },
  { code: "S-VEILLE", verdict: "a_surveiller" },
];




afterEach(() => vi.unstubAllGlobals());

describe("buildFacetTarget", () => {
  it("targets the native identity (citySlug, type, id)", () => {
    expect(buildFacetTarget(signalNode())).toEqual({
      citySlug: "ville-synth",
      type: "Signal",
      id: "sig-1",
    });
  });

  it("carries the graph id verbatim, never a positional id", () => {
    const target = buildFacetTarget(signalNode({ id: "evt-42-native" }));
    expect(target?.id).toBe("evt-42-native");
  });

  it("returns null without citySlug: no controls for such a node", () => {
    expect(buildFacetTarget(signalNode({ citySlug: null }))).toBeNull();
    expect(buildFacetTarget(signalNode({ citySlug: "  " }))).toBeNull();
  });

  it("returns null for unknown node types and empty ids", () => {
    expect(buildFacetTarget(signalNode({ type: "Lot" }))).toBeNull();
    expect(buildFacetTarget(signalNode({ id: "" }))).toBeNull();
  });
});

describe("codesForVerdict", () => {
  it("filters on the exact verdict when the prefix contradicts it", () => {
    expect(codesForVerdict(CODES, "pertinent").map((row) => row.code)).toEqual([
      "P-DENSITE",
    ]);
    expect(codesForVerdict(CODES, "non_pertinent").map((row) => row.code)).toEqual([
      "P-BIDON",
      "N-ADMIN",
    ]);
    expect(codesForVerdict(CODES, "a_surveiller").map((row) => row.code)).toEqual([
      "N-LEURRE",
      "S-VEILLE",
    ]);
  });
});

