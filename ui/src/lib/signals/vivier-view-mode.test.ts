import { describe, expect, it } from "vitest";
import type { GraphSignalNode } from "./graph-signal-detail-client.js";
import {
  A_SUBSET_KEY,
  B_SUBSET_KEY,
  canOpenProjectedSignal,
  clearVivierCityTransientState,
  countForVivierCity,
  initialVivierSubsetKey,
  reconcileVivierRouteSubset,
  modeFromSubsetKey,
  projectNodesForVivierMode,
  reconcileVivierSelection,
  retainProjectedSignalId,
  routeSubsetKey,
  subsetKeyForMode,
  sumVivierBCounts,
  validateVivierProjectionAuthority,
  vivierRouteKey,
} from "./vivier-view-mode.js";
import { createSelectionBucketState, makeKey } from "$lib/maps/selection-bucket.js";
import { normalizeGeoRouteState, type GeoRoute } from "$lib/router/geo-route.js";

type TriState = "oui" | "non" | "indetermine";

/** Une classification `vivier_v2` serveur minimale mais réaliste. */
function classification(
  zonage: TriState,
  residentiel: TriState,
  exclusionReason: string | null = null,
  instrument = "rezonage",
) {
  return {
    zonage: { valeur: zonage, source: "test", confiance: 0.95 },
    residentiel: { valeur: residentiel, source: "test", confiance: 0.9 },
    effet_densifiant: "inconnu",
    instrument,
    etape: "avis_motion",
    etapes_historique: ["avis_motion"],
    exclusion_reason: exclusionReason,
    provenance: { extrait: "" },
    confiance: 0.9,
  } as unknown as GraphSignalNode["classification"];
}

function node(
  id: string,
  z: boolean,
  m: boolean,
  p: boolean,
  vivier = classification("oui", "oui"),
): GraphSignalNode {
  return {
    id,
    type: "Signal",
    label: id,
    citySlug: "sutton",
    sourceRef: null,
    createdAt: null,
    props: {},
    classification: vivier,
    legacySubset: { version: "legacy-zmp-v1", signalId: id, flags: { z, m, p } },
  };
}

const SUTTON_RAW = [
  node("sutton-a", true, true, true),
  node("sutton-t", true, false, true),
  node("sutton-z", true, false, false),
  // Résidentiel indéterminé → « à confirmer », donc hors de B.
  node("sutton-m", false, true, false, classification("oui", "indetermine")),
  // Exclu par le serveur → hors de B.
  node("sutton-raw", false, false, false, classification("oui", "non", "non_residentiel_franc")),
];
const SUTTON_AUTHORITY = {
  version: "legacy-zmp-v1" as const,
  a: { count: 1, signalIds: ["sutton-a"] },
};

describe("Vivier A / B view contract", () => {
  it("keeps A as the default and only leaves it on the explicit B key", () => {
    expect(modeFromSubsetKey(null)).toBe("a");
    expect(modeFromSubsetKey("")).toBe("a");
    expect(modeFromSubsetKey("z|m|p")).toBe("a");
    expect(modeFromSubsetKey("z")).toBe("a");
    expect(modeFromSubsetKey("vivier-v2")).toBe("b");
    expect(A_SUBSET_KEY).toBe("z|m|p");
    expect(B_SUBSET_KEY).toBe("vivier-v2");
    expect(subsetKeyForMode("a")).toBe("z|m|p");
    expect(subsetKeyForMode("b")).toBe("vivier-v2");
  });

  it("resolves the retired z|p transition key back to A", () => {
    // z|p était la régression de prod (#375) : plus aucune clé ne l'active.
    for (const legacy of ["z|p", "p|z", "z|m", "m|p", "transition"]) {
      expect(modeFromSubsetKey(legacy)).toBe("a");
      expect(subsetKeyForMode(modeFromSubsetKey(legacy))).toBe(A_SUBSET_KEY);
    }
  });

  it("projects exact Sutton IDs for A and server-qualified nodes for B", () => {
    const a = projectNodesForVivierMode(SUTTON_RAW, SUTTON_AUTHORITY, "a");
    const b = projectNodesForVivierMode(SUTTON_RAW, SUTTON_AUTHORITY, "b");

    expect(SUTTON_RAW).toHaveLength(5);
    expect(a).toEqual({ available: true, count: 1, nodes: [SUTTON_RAW[0]] });
    expect(a.nodes.map((item) => item.id)).toEqual(["sutton-a"]);
    // B = zonage oui ∩ résidentiel oui ∩ sans exclusion : ni le « à confirmer »
    // ni l'exclu ne passent, et B ignore le gate multi4 de A.
    expect(b.nodes.map((item) => item.id)).toEqual(["sutton-a", "sutton-t", "sutton-z"]);
    expect(b.count).toBe(3);
  });

  it("marks B unavailable rather than inventing a client classification", () => {
    const unclassified = { ...SUTTON_RAW[0]!, classification: undefined };
    expect(projectNodesForVivierMode([unclassified], SUTTON_AUTHORITY, "b")).toEqual({
      available: false,
      count: null,
      nodes: [],
    });
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

  it("validates A and B independently", () => {
    const authority = { ...SUTTON_AUTHORITY, a: { count: 1, signalIds: ["wrong-a-id"] } };
    const validated = validateVivierProjectionAuthority(SUTTON_RAW, authority);

    // Une autorité A corrompue n'entraîne pas B, qui a sa propre source.
    expect(validated.a).toEqual({ available: false, count: null, nodes: [] });
    expect(validated.b.count).toBe(3);
  });

  it("reads A from subsetCounts and B from the server's vivierV2Counts", () => {
    const entry = {
      subsetCounts: { "z|m|p": 3, "z|p": 88 },
      vivierV2Counts: {
        qualified: 12,
        residentialUnknown: 40,
        excludedByReason: {
          non_residentiel_franc: 2,
          piia_non_pertinent: 1,
          hors_zonage: 3,
          derogation_hors_sujet: 0,
        },
        stageCounts: {
          avis_motion: 12,
          projet_reglement: 0,
          consultation_publique: 0,
          second_projet: 0,
          adoption: 0,
          entree_vigueur: 0,
          inconnu: 0,
        },
        total: 58,
      },
    };

    expect(countForVivierCity(entry, "a")).toBe(3);
    expect(countForVivierCity(entry, "b")).toBe(12);
    // Une ville sans comptes v2 n'invente pas un vivier.
    expect(countForVivierCity({ subsetCounts: {}, vivierV2Counts: null }, "b")).toBe(0);

    // Les trois compteurs restent séparés : aucun total ne les fond.
    expect(sumVivierBCounts([entry, entry])).toEqual({
      qualified: 24,
      residentialUnknown: 80,
      excluded: 12,
    });
  });

  it("resynchronizes route mode and keys route identity by A/B", () => {
    const route = (subset: string[]): GeoRoute => ({
      level: "city",
      citySlug: "sutton",
      state: normalizeGeoRouteState({ filters: { subset } }),
    });
    expect(routeSubsetKey(route(["z", "m", "p"]))).toBe("z|m|p");
    expect(routeSubsetKey(route(["vivier-v2"]))).toBe("vivier-v2");
    expect(routeSubsetKey(route([]))).toBeNull();
    expect(routeSubsetKey(route(["z"]))).toBe("z|m|p");
    // Une vieille URL/préférence z|p retombe sur A, jamais sur B.
    expect(routeSubsetKey(route(["z", "p"]))).toBe("z|m|p");
    expect(reconcileVivierRouteSubset(route([]), "z|p")).toBe("z|m|p");
    expect(initialVivierSubsetKey(route([]), "z|p")).toBe("z|m|p");
    expect(initialVivierSubsetKey(route([]), "vivier-v2")).toBe("vivier-v2");
    expect(initialVivierSubsetKey(null, null)).toBe(A_SUBSET_KEY);
    expect(vivierRouteKey(route(["z", "m", "p"]))).not.toBe(vivierRouteKey(route(["vivier-v2"])));
  });

  it("clears evidence and hover when navigating to another city in the same mode", () => {
    const state = {
      activeEvidence: { nodeId: "old-signal" },
      activeDocument: { docSha: "old-doc" },
      hoveredEvidenceSignalId: "old-signal",
    };

    expect(clearVivierCityTransientState("sutton", "coaticook", state)).toEqual({
      activeEvidence: null,
      activeDocument: null,
      hoveredEvidenceSignalId: null,
    });
    expect(clearVivierCityTransientState("sutton", "sutton", state)).toBe(state);
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
    expect(canOpenProjectedSignal("sutton-t", [SUTTON_RAW[0]!])).toBe(false);
    expect(canOpenProjectedSignal("sutton-a", [SUTTON_RAW[0]!])).toBe(true);
  });
});
