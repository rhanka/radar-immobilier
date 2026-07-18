import { describe, expect, it } from "vitest";
import type { GraphSignalNode } from "./graph-signal-detail-client.js";
import {
  A_SUBSET_KEY,
  aFlagsFromKey,
  B_PRECOCE_SUBSET_KEY,
  B_SUBSET_KEY,
  bAxesFromVivierKey,
  canOpenProjectedSignal,
  clearVivierCityTransientState,
  countForVivierCity,
  DEFAULT_A_FLAGS,
  initialVivierSubsetKey,
  keyForVivierB,
  keyFromAFlags,
  reconcileVivierRouteSubset,
  modeFromSubsetKey,
  projectNodesForVivierKey,
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
  etape = "avis_motion",
) {
  return {
    zonage: { valeur: zonage, source: "test", confiance: 0.95 },
    residentiel: { valeur: residentiel, source: "test", confiance: 0.9 },
    effet_densifiant: "inconnu",
    instrument,
    etape,
    etapes_historique: [etape],
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
  it("keeps A as the default and only leaves it on an explicit B key", () => {
    expect(modeFromSubsetKey(null)).toBe("a");
    expect(modeFromSubsetKey("")).toBe("a");
    expect(modeFromSubsetKey("z|m|p")).toBe("a");
    expect(modeFromSubsetKey("z")).toBe("a");
    expect(modeFromSubsetKey("z|p")).toBe("a");
    expect(modeFromSubsetKey("vivier-v2")).toBe("b");
    // La restriction précoce de B reste B (jeton opaque dérivé).
    expect(modeFromSubsetKey("vivier-v2|p")).toBe("b");
    expect(A_SUBSET_KEY).toBe("z|m|p");
    expect(B_SUBSET_KEY).toBe("vivier-v2");
    expect(B_PRECOCE_SUBSET_KEY).toBe("vivier-v2|p");
    expect(subsetKeyForMode("a")).toBe("z|m|p");
    expect(subsetKeyForMode("b")).toBe("vivier-v2");
  });

  it("composes the A key from combinable axes (default z|m|p)", () => {
    expect(DEFAULT_A_FLAGS).toEqual({ z: true, m: true, p: true });
    expect(keyFromAFlags(DEFAULT_A_FLAGS)).toBe("z|m|p");
    // Décocher multi 4+ recompose la clé (retour du mécanisme d'avant #376).
    expect(keyFromAFlags({ z: true, m: false, p: true })).toBe("z|p");
    expect(keyFromAFlags({ z: true, m: true, p: false })).toBe("z|m");
    expect(keyFromAFlags({ z: true, m: false, p: false })).toBe("z");
    // Tout décocher → clé vide (tous les signaux).
    expect(keyFromAFlags({ z: false, m: false, p: false })).toBe("");
    // Round-trip clé → axes → clé.
    for (const key of ["z|m|p", "z|p", "z|m", "m|p", "z", "m", "p", ""]) {
      expect(keyFromAFlags(aFlagsFromKey(key))).toBe(key);
    }
  });

  it("composes the B key from its three axes (opaque namespace, back-compatible)", () => {
    // Défaut Zonage ✓ Résidentiel ✓ Précoce ✗ = la clé historique `vivier-v2`.
    expect(keyForVivierB({ z: true, r: true, p: false })).toBe("vivier-v2");
    // Le seul axe précoce reste la clé historique `vivier-v2|p`.
    expect(keyForVivierB({ z: true, r: true, p: true })).toBe("vivier-v2|p");
    // Décocher un axe ajoute un jeton de relâchement, toujours dans le namespace B.
    expect(keyForVivierB({ z: true, r: false, p: false })).toBe("vivier-v2|-r");
    expect(keyForVivierB({ z: false, r: true, p: false })).toBe("vivier-v2|-z");
    expect(keyForVivierB({ z: false, r: false, p: true })).toBe("vivier-v2|-z|-r|p");
    // Toutes ces clés relèvent bien du mode B.
    for (const key of ["vivier-v2", "vivier-v2|p", "vivier-v2|-r", "vivier-v2|-z|-r|p"]) {
      expect(modeFromSubsetKey(key)).toBe("b");
    }
    // Round-trip clé → axes → clé.
    for (const axes of [
      { z: true, r: true, p: false },
      { z: true, r: true, p: true },
      { z: true, r: false, p: false },
      { z: false, r: true, p: true },
      { z: false, r: false, p: false },
    ]) {
      expect(bAxesFromVivierKey(keyForVivierB(axes))).toEqual(axes);
    }
  });

  it("resolves the retired z|p transition key to mode A", () => {
    // z|p était la régression de prod (#375) : elle reste A, jamais B.
    for (const legacy of ["z|p", "p|z", "z|m", "m|p", "transition"]) {
      expect(modeFromSubsetKey(legacy)).toBe("a");
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

  it("projects A sub-selections by relaxing the composed axes", () => {
    // z|m|p (défaut) = la projection EXACTE validée par l'autorité serveur.
    expect(projectNodesForVivierKey(SUTTON_RAW, SUTTON_AUTHORITY, "z|m|p").nodes.map((n) => n.id))
      .toEqual(["sutton-a"]);
    // Décocher multi 4+ → z|p → tous les z ∩ p (sémantique superset de subsetCounts).
    expect(projectNodesForVivierKey(SUTTON_RAW, SUTTON_AUTHORITY, "z|p").nodes.map((n) => n.id))
      .toEqual(["sutton-a", "sutton-t"]);
    // z seul → tout signal zonage.
    expect(projectNodesForVivierKey(SUTTON_RAW, SUTTON_AUTHORITY, "z").nodes.map((n) => n.id))
      .toEqual(["sutton-a", "sutton-t", "sutton-z"]);
    // Clé vide → aucun filtre → tous les signaux.
    expect(projectNodesForVivierKey(SUTTON_RAW, SUTTON_AUTHORITY, "").count).toBe(5);
  });

  it("restricts B to precoce stages when the axis is checked", () => {
    // Un vivier qualifié mêlant étapes précoces et tardives.
    const nodes = [
      node("q-avis", true, false, true, classification("oui", "oui", null, "rezonage", "avis_motion")),
      node("q-projet", true, false, true, classification("oui", "oui", null, "rezonage", "projet_reglement")),
      node("q-adoption", true, false, false, classification("oui", "oui", null, "rezonage", "adoption")),
    ];
    // vivier-v2 = tout le qualifié.
    expect(projectNodesForVivierKey(nodes, null, "vivier-v2").nodes.map((n) => n.id))
      .toEqual(["q-avis", "q-projet", "q-adoption"]);
    // vivier-v2|p = qualifié ∩ précoce (avis_motion / projet_reglement).
    expect(projectNodesForVivierKey(nodes, null, "vivier-v2|p").nodes.map((n) => n.id))
      .toEqual(["q-avis", "q-projet"]);
  });

  it("relaxes B when the résidentiel or zonage axis is unchecked (m1.4)", () => {
    // SUTTON_RAW : sutton-m est « à confirmer » (résidentiel indéterminé, non
    // exclu), sutton-raw est exclu par le serveur (jamais montré).
    // Défaut (zonage ✓ résidentiel ✓ précoce ✗) = le vivier qualifié.
    expect(projectNodesForVivierKey(SUTTON_RAW, SUTTON_AUTHORITY, "vivier-v2").nodes.map((n) => n.id))
      .toEqual(["sutton-a", "sutton-t", "sutton-z"]);
    // Décocher « Résidentiel » (vivier-v2|-r) RELÂCHE l'exigence résidentiel :
    // le « à confirmer » réapparaît, l'exclu serveur reste écarté.
    expect(projectNodesForVivierKey(SUTTON_RAW, SUTTON_AUTHORITY, "vivier-v2|-r").nodes.map((n) => n.id))
      .toEqual(["sutton-a", "sutton-t", "sutton-z", "sutton-m"]);
    // Décocher « Zonage » (vivier-v2|-z) : ici tous portent zonage oui → même set
    // que le défaut, l'exclu serveur reste écarté.
    expect(projectNodesForVivierKey(SUTTON_RAW, SUTTON_AUTHORITY, "vivier-v2|-z").nodes.map((n) => n.id))
      .toEqual(["sutton-a", "sutton-t", "sutton-z"]);
    // Décocher zonage ET résidentiel : tout le classifié non exclu par le serveur.
    expect(projectNodesForVivierKey(SUTTON_RAW, SUTTON_AUTHORITY, "vivier-v2|-z|-r").count).toBe(4);
    // Un axe B relâché n'invente aucune classification : sans classification → indispo.
    const unclassified = { ...SUTTON_RAW[0]!, classification: undefined };
    expect(projectNodesForVivierKey([unclassified], SUTTON_AUTHORITY, "vivier-v2|-r"))
      .toEqual({ available: false, count: null, nodes: [] });
  });

  it("marks B unavailable rather than inventing a client classification", () => {
    const unclassified = { ...SUTTON_RAW[0]!, classification: undefined };
    expect(projectNodesForVivierKey([unclassified], SUTTON_AUTHORITY, "vivier-v2")).toEqual({
      available: false,
      count: null,
      nodes: [],
    });
    expect(projectNodesForVivierKey([unclassified], SUTTON_AUTHORITY, "vivier-v2|p")).toEqual({
      available: false,
      count: null,
      nodes: [],
    });
  });

  it("marks a composed A projection unavailable instead of using a client fallback", () => {
    const incompatible = { ...SUTTON_RAW[0]!, legacySubset: undefined };
    expect(projectNodesForVivierKey([incompatible], SUTTON_AUTHORITY, "z|m|p"))
      .toEqual({ available: false, count: null, nodes: [] });
    // Une sous-sélection sur un nœud sans flags serveur reste indisponible.
    expect(projectNodesForVivierKey([incompatible], SUTTON_AUTHORITY, "z|p"))
      .toEqual({ available: false, count: null, nodes: [] });
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

  it("reads A from subsetCounts (by composed key) and B from vivierV2Counts", () => {
    const entry = {
      subsetCounts: { "z|m|p": 3, "z|p": 88, z: 120, "": 200 },
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
          avis_motion: 7,
          projet_reglement: 2,
          consultation_publique: 1,
          second_projet: 0,
          adoption: 2,
          entree_vigueur: 0,
          inconnu: 0,
        },
        total: 58,
      },
    };

    // A lit la clé composée directement (défaut et sous-sélections).
    expect(countForVivierCity(entry, "z|m|p")).toBe(3);
    expect(countForVivierCity(entry, "z|p")).toBe(88);
    expect(countForVivierCity(entry, "z")).toBe(120);
    expect(countForVivierCity(entry, "")).toBe(200);
    // Une clé A absente des comptes bulk n'invente rien → 0 (la ville ne saute pas).
    expect(countForVivierCity(entry, "m|p")).toBe(0);
    // B = qualified ; B précoce = somme des étapes précoces de stageCounts.
    expect(countForVivierCity(entry, "vivier-v2")).toBe(12);
    expect(countForVivierCity(entry, "vivier-v2|p")).toBe(9);
    // Une ville sans comptes v2 n'invente pas un vivier.
    expect(countForVivierCity({ subsetCounts: {}, vivierV2Counts: null }, "vivier-v2")).toBe(0);
    expect(countForVivierCity({ subsetCounts: {}, vivierV2Counts: null }, "vivier-v2|p")).toBe(0);

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

  it("preserves the LIVE sub-selection across a same-mode city navigation (m1.8)", () => {
    // La route ville ne porte QUE la clé de MODE (ex. `vivier-v2`) : la
    // sous-sélection vive (précoce, axes B/A relâchés) n'y est jamais persistée.
    // Naviguer vers une autre ville ne doit donc PAS écraser cet état vif.
    const route = (subset: string[]): GeoRoute => ({
      level: "city",
      citySlug: "sutton",
      state: normalizeGeoRouteState({ filters: { subset } }),
    });
    // B : précoce coché survit à la navigation ville (le bug : il se décochait).
    expect(reconcileVivierRouteSubset(route(["vivier-v2"]), "vivier-v2|p")).toBe("vivier-v2|p");
    // B : axe relâché (résidentiel décoché) survit aussi.
    expect(reconcileVivierRouteSubset(route(["vivier-v2"]), "vivier-v2|-r")).toBe("vivier-v2|-r");
    // A : une sous-sélection d'axes (multi 4+ décoché) survit de même.
    expect(reconcileVivierRouteSubset(route(["z", "m", "p"]), "z|p")).toBe("z|p");
    // Un VRAI changement de mode (deep-link A→B) repart du défaut du tab B.
    expect(reconcileVivierRouteSubset(route(["vivier-v2"]), "z|p")).toBe("vivier-v2");
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
