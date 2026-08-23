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
  projectComposedVivierB,
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
import {
  countVivierClassifications,
  vivierV2Schema,
  type VivierV2,
  type VivierV2Counts,
} from "@radar/domain";

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
  // Rezonage dont le résidentiel n'est pas précisé : ÉLIGIBLE (une refonte
  // redessine la grille de zonage, donc elle peut être résidentielle).
  node("sutton-m", false, true, false, classification("oui", "indetermine")),
  // Dérogation mineure indéterminée : vraie inconnue, PAS éligible — c'est ce
  // qui empêche l'axe `r` de redevenir un filtre qui ne filtre rien.
  node("sutton-d", false, true, false, classification("oui", "indetermine", null, "derogation")),
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
    // `vivier-v2` remains the persisted mode key. On direct/reload it now infers
    // the product default (Précoce ✓); explicit live combinations keep their intent.
    expect(keyForVivierB({ z: true, r: true, p: false })).toBe("vivier-v2|-p");
    expect(bAxesFromVivierKey("vivier-v2")).toEqual({ z: true, r: true, p: true });
    // The explicit precoce axis stays `vivier-v2|p`.
    expect(keyForVivierB({ z: true, r: true, p: true })).toBe("vivier-v2|p");
    // Décocher un axe ajoute un jeton de relâchement, toujours dans le namespace B.
    expect(keyForVivierB({ z: true, r: false, p: false })).toBe("vivier-v2|-r|-p");
    expect(keyForVivierB({ z: false, r: true, p: false })).toBe("vivier-v2|-z|-p");
    expect(keyForVivierB({ z: false, r: false, p: true })).toBe("vivier-v2|-z|-r|p");
    // Toutes ces clés relèvent bien du mode B.
    for (const key of ["vivier-v2", "vivier-v2|p", "vivier-v2|-r|-p", "vivier-v2|-z|-r|p"]) {
      expect(modeFromSubsetKey(key)).toBe("b");
    }
    // Round-trip clé → axes → clé.
    for (const axes of [
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

    expect(SUTTON_RAW).toHaveLength(6);
    expect(a).toEqual({ available: true, count: 1, nodes: [SUTTON_RAW[0]] });
    expect(a.nodes.map((item) => item.id)).toEqual(["sutton-a"]);
    // B default (r=true) = residential ELIGIBLE: `oui` plus the rezoning left
    // unstated (sutton-m). The indéterminé dérogation (sutton-d) stays out —
    // it is a genuine unknown, not an unstated reform.
    expect(b.nodes.map((item) => item.id)).toEqual([
      "sutton-a",
      "sutton-t",
      "sutton-z",
      "sutton-m",
    ]);
    expect(b.count).toBe(4);
  });

  it("projects and counts the B-prime-normalized B payload", () => {
    const regionalCommercialPole = node(
      "regional-commercial-pole",
      true,
      true,
      true,
      classification("oui", "non", "non_residentiel_franc"),
    );
    regionalCommercialPole.bPrime = {
      etape: "avis_motion",
      residentiel: "non",
      exclusionReason: "pole_commercial_regional",
      provenance: { extrait: "Pôle commercial régional" },
      effetDensifiant: "inconnu",
    };

    // The map/detail projection consumes the normalized server classification.
    expect(projectNodesForVivierKey(
      [regionalCommercialPole],
      SUTTON_AUTHORITY,
      "vivier-v2|-p",
    )).toEqual({ available: true, count: 0, nodes: [] });
    // The rail/map bulk counter reads the same active-B exclusion outcome.
    expect(countForVivierCity({
      subsetCounts: { "z|m|p": 1 },
      vivierV2Counts: {
        qualified: 0,
        residentialUnknown: 0,
        excludedByReason: {
          non_residentiel_franc: 1,
          piia_non_pertinent: 0,
          hors_zonage: 0,
          derogation_hors_sujet: 0,
        },
        stageCounts: {
          avis_motion: 0,
          projet_reglement: 0,
          consultation_publique: 0,
          second_projet: 0,
          adoption: 0,
          entree_vigueur: 0,
          inconnu: 0,
        },
        stageCountsHorsZonage: {
          avis_motion: 0,
          projet_reglement: 0,
          consultation_publique: 0,
          second_projet: 0,
          adoption: 0,
          entree_vigueur: 0,
          inconnu: 0,
        },
        stageCountsResEligible: {
          avis_motion: 0,
          projet_reglement: 0,
          consultation_publique: 0,
          second_projet: 0,
          adoption: 0,
          entree_vigueur: 0,
          inconnu: 0,
        },
        stageCountsResEligibleHorsZonage: {
          avis_motion: 0,
          projet_reglement: 0,
          consultation_publique: 0,
          second_projet: 0,
          adoption: 0,
          entree_vigueur: 0,
          inconnu: 0,
        },
        total: 1,
      },
    }, "vivier-v2|-p")).toBe(0);
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
    expect(projectNodesForVivierKey(SUTTON_RAW, SUTTON_AUTHORITY, "").count).toBe(6);
  });

  it("restricts B to precoce stages when the axis is checked", () => {
    // Un vivier qualifié mêlant étapes précoces et tardives.
    const nodes = [
      node("q-avis", true, false, true, classification("oui", "oui", null, "rezonage", "avis_motion")),
      node("q-projet", true, false, true, classification("oui", "oui", null, "rezonage", "projet_reglement")),
      node("q-adoption", true, false, false, classification("oui", "oui", null, "rezonage", "adoption")),
    ];
    // vivier-v2 is the canonical mode key and now applies the default Précoce axis.
    expect(projectNodesForVivierKey(nodes, null, "vivier-v2").nodes.map((n) => n.id))
      .toEqual(["q-avis", "q-projet"]);
    // vivier-v2|p = qualifié ∩ précoce (avis_motion / projet_reglement).
    expect(projectNodesForVivierKey(nodes, null, "vivier-v2|p").nodes.map((n) => n.id))
      .toEqual(["q-avis", "q-projet"]);
  });

  it("r axis keeps unstated rezonings, still filters genuine unknowns, relaxes when unchecked", () => {
    // sutton-m = rezoning, residential unstated → ELIGIBLE (R2: a reform ranks,
    // it never gates). sutton-d = dérogation, residential unstated → genuine
    // unknown, filtered. This pair is what keeps `r` an actual filter.
    expect(projectNodesForVivierKey(SUTTON_RAW, SUTTON_AUTHORITY, "vivier-v2").nodes.map((n) => n.id))
      .toEqual(["sutton-a", "sutton-t", "sutton-z", "sutton-m"]);
    // Uncheck r: every indéterminé reappears (not reclassified, just unfiltered).
    expect(projectNodesForVivierKey(SUTTON_RAW, SUTTON_AUTHORITY, "vivier-v2|-r").nodes.map((n) => n.id))
      .toEqual(["sutton-a", "sutton-t", "sutton-z", "sutton-m", "sutton-d"]);
    // Uncheck z (r still checked): same eligible set (all happen to be zonage=oui).
    expect(projectNodesForVivierKey(SUTTON_RAW, SUTTON_AUTHORITY, "vivier-v2|-z").nodes.map((n) => n.id))
      .toEqual(["sutton-a", "sutton-t", "sutton-z", "sutton-m"]);
    // Uncheck both z and r: all non-excluded.
    expect(projectNodesForVivierKey(SUTTON_RAW, SUTTON_AUTHORITY, "vivier-v2|-z|-r").nodes.map((n) => n.id))
      .toEqual(["sutton-a", "sutton-t", "sutton-z", "sutton-m", "sutton-d"]);
    expect(projectNodesForVivierKey(SUTTON_RAW, SUTTON_AUTHORITY, "vivier-v2|-z|-r").count).toBe(5);
    // The server-excluded node never appears regardless of axes.
    expect(projectNodesForVivierKey(SUTTON_RAW, SUTTON_AUTHORITY, "vivier-v2|-z|-r").nodes.map((n) => n.id))
      .not.toContain("sutton-raw");
    // Missing classification → unavailable (not partial).
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
    // B = périmètre permissif (qualifié + tout « à confirmer » indéterminé) = 5.
    expect(validated.a).toEqual({ available: false, count: null, nodes: [] });
    expect(validated.b.count).toBe(5);
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
        stageCountsHorsZonage: {
          avis_motion: 0,
          projet_reglement: 0,
          consultation_publique: 0,
          second_projet: 0,
          adoption: 0,
          entree_vigueur: 0,
          inconnu: 0,
        },
        stageCountsResEligible: {
          avis_motion: 5,
          projet_reglement: 1,
          consultation_publique: 1,
          second_projet: 0,
          adoption: 1,
          entree_vigueur: 0,
          inconnu: 0,
        },
        stageCountsResEligibleHorsZonage: {
          avis_motion: 0,
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

    // A reads the composed key directly (unchanged).
    expect(countForVivierCity(entry, "z|m|p")).toBe(3);
    expect(countForVivierCity(entry, "z|p")).toBe(88);
    expect(countForVivierCity(entry, "z")).toBe(120);
    expect(countForVivierCity(entry, "")).toBe(200);
    expect(countForVivierCity(entry, "m|p")).toBe(0);
    // B default (r=true, p=true): reads stageCountsResEligible précoce = 5+1 = 6.
    expect(countForVivierCity(entry, "vivier-v2")).toBe(6);
    expect(countForVivierCity(entry, "vivier-v2|p")).toBe(6);
    // B with r unchecked reads stageCounts précoce = 7+2 = 9.
    expect(countForVivierCity(entry, keyForVivierB({ z: true, r: false, p: true }))).toBe(9);
    // Null vivierV2Counts → 0.
    expect(countForVivierCity({ subsetCounts: {}, vivierV2Counts: null }, "vivier-v2")).toBe(0);
    expect(countForVivierCity({ subsetCounts: {}, vivierV2Counts: null }, "vivier-v2|p")).toBe(0);

    expect(sumVivierBCounts([entry, entry])).toEqual({
      qualified: 24,
      residentialUnknown: 80,
      excluded: 12,
    });
  });

  it("r axis separates confirmed residential from indéterminé in rail count", () => {
    // Sutton-like city: 2 signals are residential=indéterminé (reforms).
    // With r=true (default): they are filtered → count=0.
    // With r=false: they reappear → count=2.
    const suttonLike = {
      subsetCounts: { "z|m|p": 0 },
      vivierV2Counts: {
        qualified: 0,
        residentialUnknown: 2,
        excludedByReason: {
          non_residentiel_franc: 0,
          piia_non_pertinent: 0,
          hors_zonage: 0,
          derogation_hors_sujet: 0,
        },
        stageCounts: {
          avis_motion: 0,
          projet_reglement: 2,
          consultation_publique: 0,
          second_projet: 0,
          adoption: 0,
          entree_vigueur: 0,
          inconnu: 0,
        },
        stageCountsHorsZonage: {
          avis_motion: 0,
          projet_reglement: 0,
          consultation_publique: 0,
          second_projet: 0,
          adoption: 0,
          entree_vigueur: 0,
          inconnu: 0,
        },
        stageCountsResEligible: {
          avis_motion: 0,
          projet_reglement: 0,
          consultation_publique: 0,
          second_projet: 0,
          adoption: 0,
          entree_vigueur: 0,
          inconnu: 0,
        },
        stageCountsResEligibleHorsZonage: {
          avis_motion: 0,
          projet_reglement: 0,
          consultation_publique: 0,
          second_projet: 0,
          adoption: 0,
          entree_vigueur: 0,
          inconnu: 0,
        },
        total: 2,
      },
    };
    // Default (r=true, p=true): residential=oui only → 0.
    expect(countForVivierCity(suttonLike, "vivier-v2")).toBe(0);
    expect(countForVivierCity(suttonLike, "vivier-v2|p")).toBe(0);
    // Uncheck r: indéterminé reappears → 2.
    expect(countForVivierCity(suttonLike, keyForVivierB({ z: true, r: false, p: true }))).toBe(2);
    expect(countForVivierCity(suttonLike, keyForVivierB({ z: true, r: false, p: false }))).toBe(2);
  });

  it("PARITÉ rail↔panneau pour TOUS les axes B (z/r/p) — compteurs serveur recomposables", () => {
    // Le rail lit les compteurs serveur (`countVivierClassifications`) ; le panneau
    // filtre nœud par nœud (`projectComposedVivierB`). Sur le MÊME jeu de nœuds,
    // les deux DOIVENT rendre la même composition pour les 8 combinaisons d'axes —
    // c'était RÉFUTÉ (le rail ne comptait que selon `p`, jamais `z`).
    const cls = (
      zonage: TriState,
      residentiel: TriState,
      etape: string,
      exclusion: string | null = null,
    ) => classification(zonage, residentiel, exclusion, "rezonage", etape);

    const nodes: GraphSignalNode[] = [
      // périmètre (zonage oui), précoce, qualifié
      node("n-perim-precoce", true, true, true, cls("oui", "oui", "avis_motion")),
      // périmètre (zonage oui), tardif, indéterminé « à confirmer »
      node("n-perim-tardif", true, false, false, cls("oui", "indetermine", "adoption")),
      // HORS zonage (zonage indéterminé), précoce, résidentiel — révélé si z décoché
      node("n-hors-precoce", false, true, false, cls("indetermine", "oui", "projet_reglement")),
      // HORS zonage (zonage indéterminé), tardif, indéterminé — révélé si z décoché
      node("n-hors-tardif", false, false, false, cls("indetermine", "indetermine", "consultation_publique")),
      // franc-non-résidentiel : exclu serveur → jamais dans B (ni rail ni panneau)
      node("n-exclu", false, false, false, cls("oui", "non", "avis_motion", "non_residentiel_franc")),
    ];

    const serverCounts: VivierV2Counts = countVivierClassifications(
      nodes.map((n) => n.classification as unknown as VivierV2),
    );
    const entry = { subsetCounts: {}, vivierV2Counts: serverCounts };

    for (const z of [true, false]) {
      for (const r of [true, false]) {
        for (const p of [true, false]) {
          const axes = { z, r, p };
          const key = keyForVivierB(axes);
          const panel = projectComposedVivierB(nodes, axes).count;
          const rail = countForVivierCity(entry, key);
          expect(rail, `parité rail↔panneau échoue pour axes=${JSON.stringify(axes)} (clé ${key})`).toBe(panel);
        }
      }
    }

    // Sanity: r=true garde le résidentiel ÉLIGIBLE. Ici tous les nœuds sont des
    // rezonages, donc leur indéterminé est « non précisé » et reste éligible.
    // z=true,r=true,p=false → stageCountsResEligible: n-perim-precoce + n-perim-tardif → 2.
    expect(countForVivierCity(entry, keyForVivierB({ z: true, r: true, p: false }))).toBe(2);
    // z=false,r=true,p=false → + stageCountsResEligibleHorsZonage: les 2 hors-zonage → 4.
    expect(countForVivierCity(entry, keyForVivierB({ z: false, r: true, p: false }))).toBe(4);
    // z=true,r=false,p=false → stageCounts: n-perim-precoce + n-perim-tardif → 2.
    expect(countForVivierCity(entry, keyForVivierB({ z: true, r: false, p: false }))).toBe(2);
    // z=false,r=false,p=false → all non-excluded → 4.
    expect(countForVivierCity(entry, keyForVivierB({ z: false, r: false, p: false }))).toBe(4);
  });

  it("rejects the DTO that would diverge rail and panel on the r axis", () => {
    const inconsistent = node(
      "invalid-non-residential",
      false,
      false,
      false,
      classification("oui", "non", null),
    );
    const rawClassification = inconsistent.classification as unknown as VivierV2;

    expect(projectComposedVivierB([inconsistent], { z: true, r: true, p: false }))
      .toEqual({ available: true, count: 0, nodes: [] });
    expect(vivierV2Schema.safeParse(rawClassification).success).toBe(false);
    expect(() => countVivierClassifications([rawClassification])).toThrow(
      "a non-residential classification must have an exclusion reason",
    );
  });

  it("migrates every route/stored subset to B — the A rail is retired (BR14-EX1)", () => {
    const route = (subset: string[]): GeoRoute => ({
      level: "city",
      citySlug: "sutton",
      state: normalizeGeoRouteState({ filters: { subset } }),
    });
    // Any deep-linked subset — the legacy A vocabulary included — resolves to B.
    expect(routeSubsetKey(route(["z", "m", "p"]))).toBe("vivier-v2");
    expect(routeSubsetKey(route(["vivier-v2"]))).toBe("vivier-v2");
    expect(routeSubsetKey(route([]))).toBeNull();
    expect(routeSubsetKey(route(["z"]))).toBe("vivier-v2");
    // Une vieille URL/préférence A (z|p, z|m|p) migre vers B, jamais un blanc.
    expect(routeSubsetKey(route(["z", "p"]))).toBe("vivier-v2");
    expect(reconcileVivierRouteSubset(route([]), "z|p")).toBe("vivier-v2");
    // CRITIQUE — clé A persistée (localStorage) → atterrit sur B.
    expect(initialVivierSubsetKey(route([]), "z|p")).toBe("vivier-v2");
    expect(initialVivierSubsetKey(route([]), A_SUBSET_KEY)).toBe("vivier-v2");
    expect(initialVivierSubsetKey(route([]), "vivier-v2")).toBe("vivier-v2");
    // CRITIQUE — défaut vierge (aucune route, aucun stockage) = B.
    expect(initialVivierSubsetKey(null, null)).toBe(B_SUBSET_KEY);
    // Un lien A et un lien B désignent désormais la MÊME vue (B) → même identité.
    expect(vivierRouteKey(route(["z", "m", "p"]))).toBe(vivierRouteKey(route(["vivier-v2"])));
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
    // B : après une désactivation explicite de Précoce, la clé live reste la
    // clé canonique. Le rail possède encore l'axe session et ne le redérive pas
    // tant que cette clé initiale n'a pas changé (couvert au rendu navigateur).
    expect(reconcileVivierRouteSubset(route(["vivier-v2"]), "vivier-v2")).toBe("vivier-v2");
    // B : axe relâché (résidentiel décoché) survit aussi; its explicit suffix
    // preserves the absence of `p`.
    expect(reconcileVivierRouteSubset(route(["vivier-v2"]), "vivier-v2|-r")).toBe("vivier-v2|-r");
    expect(bAxesFromVivierKey("vivier-v2|-r")).toMatchObject({ p: false });
    // Une route A legacy migre vers B (le rail A est retiré) — aucune survie A.
    expect(reconcileVivierRouteSubset(route(["z", "m", "p"]), "z|p")).toBe("vivier-v2");
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
