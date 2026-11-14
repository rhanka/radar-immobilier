import { describe, expect, it } from "vitest";
import { classementCountsForPerimeter, displayedSignalCountForCity, filtreCountsForPerimeter, filtreCubeOfNodes } from "./signal-filter-counts.js";
import type { GraphSignalNode } from "./graph-signal-detail-client.js";
import { buildCityMapEntries } from "$lib/maps/maps-data.js";
import { DEFAULT_CLASSEMENT_FILTER } from "./signal-classement.js";

const ALL_AXES = { z: true, r: true, p: true };
const BOTH = { piiaSansProjetResidentiel: true, derogationsMineures: true };

function node(
  id: string,
  classification: Partial<NonNullable<GraphSignalNode["classification"]>>,
  extra: Partial<GraphSignalNode> = {},
): GraphSignalNode {
  return {
    id, type: "Signal", label: id, citySlug: "delson", sourceRef: null, createdAt: null, props: {},
    classification: {
      zonage: { valeur: "oui", source: "test", confiance: 1 },
      residentiel: { valeur: "oui", source: "test", confiance: 1 },
      effet_densifiant: "inconnu", instrument: "rezonage", etape: "avis_motion",
      etapes_historique: ["avis_motion"], exclusion_reason: null,
      provenance: { extrait: "" }, confiance: 1,
      ...classification,
    } as GraphSignalNode["classification"],
    ...extra,
  };
}

const [A, B, C] = buildCityMapEntries([]).slice(0, 3).map((entry) => entry.municipality);
const entry = (municipality: typeof A, filtreCube: Record<string, number> | null, served = true) => ({
  municipality: municipality!,
  vivierV2Counts: served ? ({} as never) : null,
  filtreCube,
});

describe("displayedSignalCountForCity", () => {
  const city = { ...buildCityMapEntries([])[0]!, filtreCubesByClassement: {
    pertinent: { "11100": 2, "11000": 1, "11110": 4 },
    a_surveiller: { "11100": 3 }, non_classe: { "11100": 5 }, ecarte: { "11100": 8 },
  } };
  it("should combine relevance with axes and exclusions using the served city cube", () => {
    const filter = { ...DEFAULT_CLASSEMENT_FILTER, a_surveiller: false, non_classe: false };
    expect(displayedSignalCountForCity(city, "vivier-v2", filter, BOTH)).toBe(2);
    expect(displayedSignalCountForCity(city, "vivier-v2|-p", filter, BOTH)).toBe(3);
    expect(displayedSignalCountForCity(city, "vivier-v2", filter,
      { ...BOTH, piiaSansProjetResidentiel: false })).toBe(6);
    expect(displayedSignalCountForCity(city, "vivier-v2", { ...filter, ecarte: true }, BOTH)).toBe(10);
    expect(displayedSignalCountForCity(city, "vivier-v2", { ...filter, pertinent: false, ecarte: true }, BOTH)).toBe(8);
    expect(displayedSignalCountForCity(city, "vivier-v2", { ...filter, pertinent: false }, BOTH)).toBe(0);
  });
  it("should return zero for an absent city and unavailable for a missing class dimension", () => {
    const filter = { ...DEFAULT_CLASSEMENT_FILTER, non_classe: false };
    expect(displayedSignalCountForCity(buildCityMapEntries([])[0]!, "vivier-v2", filter, BOTH)).toBe(0);
    expect(displayedSignalCountForCity({ ...city, filtreCubesByClassement: null, filtreCube: { "11100": 2 } },
      "vivier-v2", filter, BOTH)).toBeNull();
    expect(displayedSignalCountForCity({ ...city, filtreCubesByClassement: null, filtreCube: { "11100": 2 } },
      "vivier-v2", { ...DEFAULT_CLASSEMENT_FILTER, ecarte: true }, BOTH)).toBeNull();
  });
});

describe("classementCountsForPerimeter", () => {
  const city = { ...entry(A, { "11100": 6 }), filtreCubesByClassement: {
    pertinent: { "11100": 2, "11000": 1 }, a_surveiller: { "11100": 3 },
    non_classe: { "11100": 1, "11110": 4 }, ecarte: { "11100": 5 },
  } };
  it("should count each class across cities with all other filters applied", () => {
    expect(classementCountsForPerimeter({
      entries: [city, { ...city, municipality: B! }], axes: ALL_AXES, exclusions: BOTH,
    })).toEqual({ pertinent: 4, a_surveiller: 6, non_classe: 2, ecarte: 10 });
    expect(classementCountsForPerimeter({
      entries: [city], axes: { ...ALL_AXES, p: false }, exclusions: BOTH,
    })?.pertinent).toBe(3);
  });
  it("should count full city cubes independently of incomplete selected detail", () => {
    expect(classementCountsForPerimeter({
      entries: [city, { ...city, municipality: B! }], axes: ALL_AXES, exclusions: BOTH,
    })).toEqual({ pertinent: 4, a_surveiller: 6, non_classe: 2, ecarte: 10 });
  });
  it("should distinguish an empty perimeter from a missing relevance dimension", () => {
    expect(classementCountsForPerimeter({ entries: [], axes: ALL_AXES, exclusions: BOTH }))
      .toEqual({ pertinent: 0, a_surveiller: 0, non_classe: 0, ecarte: 0 });
    expect(classementCountsForPerimeter({ entries: [entry(A, {})], axes: ALL_AXES, exclusions: BOTH }))
      .toBeNull();
  });
});

describe("filtreCubeOfNodes — selected city cube from its loaded detail", () => {
  it("should key each B node and leave server-excluded nodes out", () => {
    expect(filtreCubeOfNodes([
      node("precoce", {}),
      node("tardif", { etape: "adoption" }),
      node("piia", { instrument: "piia", etape: "adoption" }),
      node("derog", { instrument: "derogation" }),
      node("exclu", { exclusion_reason: "hors_zonage" }),
    ])).toEqual({ "11100": 1, "11000": 1, "11010": 1, "11101": 1 });
  });

  it("should return null when a node has no usable classification (no partial count)", () => {
    const bare = node("bare", {});
    delete bare.classification;
    expect(filtreCubeOfNodes([bare])).toBeNull();
  });
});

describe("filtreCountsForPerimeter — Filtre dropdown counts over the displayed perimeter", () => {
  it("should include archives in Filtre only when checked with or without selected detail", () => {
    const city = { ...entry(A, { "11100": 6 }), filtreCubesByClassement: {
      pertinent: { "11100": 1 }, a_surveiller: { "11100": 2 },
      non_classe: { "11100": 3 }, ecarte: { "11100": 1 },
    } };
    const input = { entries: [city, { ...city, municipality: B!,
      filtreCubesByClassement: { ...city.filtreCubesByClassement, ecarte: {} } }],
      axes: ALL_AXES, exclusions: BOTH };
    const classement = { ...DEFAULT_CLASSEMENT_FILTER, ecarte: true };
    expect(filtreCountsForPerimeter({ ...input, live: null })?.z).toBe(12);
    expect(filtreCountsForPerimeter({ ...input, classement, live: null }))
      .toEqual({ z: 13, r: 13, p: 13, piia: 0, derog: 0 });
    expect(filtreCountsForPerimeter({ ...input, classement,
      live: { slug: A!.slug, nodes: Array.from({ length: 7 }, (_, i) => node(String(i), {})) } }))
      .toEqual({ z: 13, r: 13, p: 13, piia: 0, derog: 0 });
    expect(filtreCountsForPerimeter({ ...input, live: null,
      classement: { pertinent: false, a_surveiller: false, non_classe: false, ecarte: true } })?.z).toBe(1);
  });

  it("should apply a partial Pertinence selection to every city before faceted counting", () => {
    const city = { ...entry(A, { "11100": 9 }), filtreCubesByClassement: {
      pertinent: { "11100": 2, "11110": 1 }, a_surveiller: { "11100": 3 },
      non_classe: { "11100": 4 }, ecarte: {},
    } };
    const counts = filtreCountsForPerimeter({
      entries: [city, { ...city, municipality: B! }], axes: ALL_AXES, exclusions: BOTH, live: null,
      classement: { pertinent: true, a_surveiller: false, non_classe: false, ecarte: false },
    });
    expect(counts).toEqual({ z: 4, r: 4, p: 4, piia: 2, derog: 0 });
  });

  it("should return unavailable rather than unfiltered counts from an older API", () => {
    expect(filtreCountsForPerimeter({
      entries: [entry(A, { "11100": 9 })], axes: ALL_AXES, exclusions: BOTH, live: null,
      classement: { ...DEFAULT_CLASSEMENT_FILTER, non_classe: false },
    })).toBeNull();
  });

  it("should count every city when no city is selected", () => {
    const counts = filtreCountsForPerimeter({
      entries: [entry(A, { "11100": 2, "11101": 1 }), entry(B, { "11100": 1, "11110": 2 }), entry(C, null, false)],
      axes: ALL_AXES, exclusions: BOTH, live: null,
    });
    expect(counts).toEqual({ z: 3, r: 3, p: 3, piia: 2, derog: 1 });
  });

  it("should preserve exact SQL counts when selected detail is incomplete", () => {
    const counts = filtreCountsForPerimeter({
      entries: [entry(A, { "11100": 9 }), entry(B, { "11100": 1 })],
      axes: ALL_AXES, exclusions: BOTH,
      // Pertinence left one early node in A's scoped detail.
      live: { slug: A!.slug, nodes: [node("kept", {})] },
    });
    expect(counts).toEqual({ z: 10, r: 10, p: 10, piia: 0, derog: 0 });
  });

  it("should give zeroes for an empty perimeter, not null", () => {
    expect(filtreCountsForPerimeter({ entries: [entry(A, null, false)], axes: ALL_AXES, exclusions: BOTH, live: null }))
      .toEqual({ z: 0, r: 0, p: 0, piia: 0, derog: 0 });
  });

  it("should return null when a served city carries no cube (older server)", () => {
    expect(filtreCountsForPerimeter({ entries: [entry(A, null)], axes: ALL_AXES, exclusions: BOTH, live: null }))
      .toBeNull();
  });
});
