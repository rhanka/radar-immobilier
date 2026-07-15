import { describe, expect, it } from "vitest";
import type { GraphSignalNode } from "./graph-signal-detail-client.js";
import {
  A_SUBSET_KEY,
  TRANSITION_SUBSET_KEY,
  modeFromSubsetKey,
  projectNodesForVivierMode,
} from "./vivier-view-mode.js";

function node(id: string, z: boolean, m: boolean, p: boolean): GraphSignalNode {
  return {
    id,
    type: "Signal",
    label: id,
    citySlug: "sutton",
    sourceRef: null,
    createdAt: null,
    props: {},
    legacySubset: { version: "legacy-zmp-v1", signalId: id, flags: { z, m, p } },
  };
}

const SUTTON_RAW = [
  node("sutton-a", true, true, true),
  node("sutton-t", true, false, true),
  node("sutton-z", true, false, false),
  node("sutton-m", false, true, false),
  node("sutton-raw", false, false, false),
];

describe("Vivier A / transition view contract", () => {
  it("keeps A as the default and never coerces exact legacy z|m|p", () => {
    expect(modeFromSubsetKey(null)).toBe("a");
    expect(modeFromSubsetKey("")).toBe("a");
    expect(modeFromSubsetKey("z|m|p")).toBe("a");
    expect(modeFromSubsetKey("z|p")).toBe("transition");
    expect(modeFromSubsetKey("p|z")).toBe("transition");
    expect(modeFromSubsetKey("z")).toBe("a");
    expect(A_SUBSET_KEY).toBe("z|m|p");
    expect(TRANSITION_SUBSET_KEY).toBe("z|p");
  });

  it("projects exact Sutton IDs with rail-count parity in both modes", () => {
    const a = projectNodesForVivierMode(SUTTON_RAW, "a");
    const transition = projectNodesForVivierMode(SUTTON_RAW, "transition");

    expect(SUTTON_RAW).toHaveLength(5);
    expect(a).toEqual({ available: true, nodes: [SUTTON_RAW[0]] });
    expect(transition).toEqual({ available: true, nodes: [SUTTON_RAW[0], SUTTON_RAW[1]] });
    expect(a.nodes.map((item) => item.id)).toEqual(["sutton-a"]);
    expect(transition.nodes.map((item) => item.id)).toEqual(["sutton-a", "sutton-t"]);
  });

  it("marks the projection unavailable instead of using a client fallback", () => {
    const incompatible = { ...SUTTON_RAW[0]!, legacySubset: undefined };
    expect(projectNodesForVivierMode([incompatible], "a")).toEqual({ available: false, nodes: [] });
  });
});
