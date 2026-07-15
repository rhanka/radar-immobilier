import { describe, expect, it } from "vitest";
import type { GraphSignalNode } from "./graph-signal-detail-client.js";
import {
  A_SUBSET_KEY,
  detailCountForCity,
  TRANSITION_SUBSET_KEY,
  modeFromSubsetKey,
  projectNodesForVivierMode,
  reconcileVivierSelection,
  retainProjectedSignalId,
  routeSubsetKey,
  vivierRouteKey,
} from "./vivier-view-mode.js";
import { createSelectionBucketState, makeKey } from "$lib/maps/selection-bucket.js";
import { normalizeGeoRouteState, type GeoRoute } from "$lib/router/geo-route.js";

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
const SUTTON_AUTHORITY = {
  version: "legacy-zmp-v1" as const,
  a: { count: 1, signalIds: ["sutton-a"] },
  transition: { count: 2, signalIds: ["sutton-a", "sutton-t"] },
};

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
    const a = projectNodesForVivierMode(SUTTON_RAW, SUTTON_AUTHORITY, "a");
    const transition = projectNodesForVivierMode(SUTTON_RAW, SUTTON_AUTHORITY, "transition");

    expect(SUTTON_RAW).toHaveLength(5);
    expect(a).toEqual({ available: true, count: 1, nodes: [SUTTON_RAW[0]] });
    expect(transition).toEqual({ available: true, count: 2, nodes: [SUTTON_RAW[0], SUTTON_RAW[1]] });
    expect(a.nodes.map((item) => item.id)).toEqual(["sutton-a"]);
    expect(transition.nodes.map((item) => item.id)).toEqual(["sutton-a", "sutton-t"]);
  });

  it("marks the projection unavailable instead of using a client fallback", () => {
    const incompatible = { ...SUTTON_RAW[0]!, legacySubset: undefined };
    expect(projectNodesForVivierMode([incompatible], SUTTON_AUTHORITY, "a")).toEqual({ available: false, count: null, nodes: [] });
  });

  it("fails closed without throwing for null or partial flags", () => {
    for (const flags of [null, { z: true, m: true }]) {
      const malformed = {
        ...SUTTON_RAW[0]!,
        legacySubset: { version: "legacy-zmp-v1", signalId: "sutton-a", flags },
      } as unknown as GraphSignalNode;
      expect(() => projectNodesForVivierMode([malformed], SUTTON_AUTHORITY, "a")).not.toThrow();
      expect(projectNodesForVivierMode([malformed], SUTTON_AUTHORITY, "a").available).toBe(false);
    }
  });

  it("uses selected-city detail counts instead of conflicting by-city counts", () => {
    const entry = { municipality: { slug: "sutton" }, subsetCounts: { "z|m|p": 99, "z|p": 88 } };
    expect(detailCountForCity(entry, "sutton", SUTTON_AUTHORITY, "a")).toBe(1);
    expect(detailCountForCity(entry, "sutton", SUTTON_AUTHORITY, "transition")).toBe(2);
    expect(detailCountForCity(entry, "sutton", null, "a")).toBeNull();
  });

  it("resynchronizes route mode and keys route identity by A/T", () => {
    const route = (subset: string[]): GeoRoute => ({
      level: "city",
      citySlug: "sutton",
      state: normalizeGeoRouteState({ filters: { subset } }),
    });
    expect(routeSubsetKey(route(["z", "m", "p"]))).toBe("z|m|p");
    expect(routeSubsetKey(route(["z", "p"]))).toBe("z|p");
    expect(vivierRouteKey(route(["z", "m", "p"]))).not.toBe(vivierRouteKey(route(["z", "p"])));
  });

  it("drops excluded signal selection and focus on a mode switch", () => {
    const municipality = makeKey("municipality", "sutton");
    const kept = makeKey("signal", "sutton-a");
    const excluded = makeKey("signal", "sutton-t");
    const state = createSelectionBucketState({
      selectedKeys: [municipality, kept, excluded],
      focusedKey: excluded,
      expandedKeys: [excluded],
    });
    const next = reconcileVivierSelection(state, new Set(["sutton-a"]));
    expect([...next.selectedKeys]).toEqual([municipality, kept]);
    expect(next.focusedKey).toBeNull();
    expect(next.expandedKeys.has(excluded)).toBe(false);
    expect(retainProjectedSignalId("sutton-t", new Set(["sutton-a"]))).toBeNull();
    expect(retainProjectedSignalId("sutton-a", new Set(["sutton-a"]))).toBe("sutton-a");
  });
});
