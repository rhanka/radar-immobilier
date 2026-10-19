import { vi } from "vitest";
import type { GeoZonesResponse } from "$lib/maps/geo-zones-client.js";

vi.mock("$lib/components/maps/GeoCityMapBase.svelte", async () => {
  const stub = await import("./test-stubs/GeoCityMapBaseStub.svelte");
  return { default: stub.default };
});

vi.mock("$lib/maps/geo-sat-basemap.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/maps/geo-sat-basemap.js")>();
  return { ...actual, isSatelliteBasemapEnabled: () => true };
});

vi.mock("$lib/auth/auth-store.js", async () => {
  const { writable } = await import("svelte/store");
  return {
    authStore: writable({
      loading: false,
      authenticated: true,
      authDisabled: false,
      loginBlocked: false,
      user: { sub: "tester-1", status: "approved" },
    }),
  };
});

vi.mock("$lib/collab/annotations-client.js", () => ({
  listAnnotations: vi.fn(async () => []),
  createAnnotation: vi.fn(async () => {}),
  editAnnotation: vi.fn(async () => {}),
  deleteAnnotation: vi.fn(async () => {}),
}));
vi.mock("$lib/collab/prospect-notes-stream.js", () => ({
  subscribeNoteFrames: () => () => {},
  noteMatchesTarget: () => false,
}));

vi.mock("$lib/signals/graph-signals-by-city-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("$lib/signals/graph-signals-by-city-client.js")>();
  return { ...actual, fetchGraphSignalsByCity: vi.fn(async () => ({ cities: [] })) };
});

vi.mock("$lib/signals/graph-signal-detail-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("$lib/signals/graph-signal-detail-client.js")>();
  return {
    ...actual,
    fetchGraphSignalDetail: vi.fn(async (citySlug: string) => ({
      ok: true,
      citySlug,
      legacyProjection: null,
      nodes: [],
    })),
  };
});

vi.mock("$lib/signals/signal-facets-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("$lib/signals/signal-facets-client.js")>();
  return {
    ...actual,
    fetchReasonCodes: vi.fn(async () => ({
      profileId: "immo-steve-2026-09",
      codes: [
        { code: "P-DENSITE", verdict: "pertinent" },
        { code: "N-ADMIN", verdict: "non_pertinent" },
      ],
    })),
    fetchCityFacets: vi.fn(async () => ({ heads: [] })),
    postFacetCommand: vi.fn(async () => ({ id: "event-1" })),
  };
});

vi.mock("$lib/maps/signaux-zones-loader.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("$lib/maps/signaux-zones-loader.js")>();
  return {
    ...actual,
    loadSignauxZones: vi.fn(async (citySlug: string) => ({
      tier: "collection" as const,
      response: fixtureZones(citySlug),
    })),
  };
});

vi.mock("$lib/maps/cptaq-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/maps/cptaq-client.js")>();
  return {
    ...actual,
    fetchCptaqConstraints: vi.fn(async () => ({
      ok: false,
      absent: true,
      featureCollection: { type: "FeatureCollection" as const, features: [] },
    })),
  };
});

vi.mock("$lib/maps/lots-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/maps/lots-client.js")>();
  return {
    ...actual,
    fetchAllLots: vi.fn(async (citySlug: string) => ({
      ok: true,
      citySlug,
      source: "donnees-quebec" as const,
      collectionId: actual.lotsCollectionId(citySlug),
      numberMatched: 0,
      numberReturned: 0,
      featureCollection: { type: "FeatureCollection" as const, features: [] },
    })),
  };
});

function fixtureZones(citySlug: string): GeoZonesResponse {
  return {
    ok: true,
    citySlug,
    source: "official",
    resolutionStatus: "official",
    geometryStatus: "official",
    zoneCount: 0,
    warnings: [],
    featureCollection: { type: "FeatureCollection", features: [] },
  };
}
