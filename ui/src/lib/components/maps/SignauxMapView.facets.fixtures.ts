// Synthetic map fixtures and isolated client mocks for facet tests.
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/svelte";
import type { Writable } from "svelte/store";
import { authStore, type AuthState } from "$lib/auth/auth-store.js";
import { buildCityMapEntries } from "$lib/maps/maps-data.js";
import { parseGeoQuery, type GeoRoute } from "$lib/router/geo-route.js";
import type { GeoZonesResponse } from "$lib/maps/geo-zones-client.js";
import type {
  GraphSignalDetailResponse,
  GraphSignalNode,
} from "$lib/signals/graph-signal-detail-client.js";

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

vi.mock("$lib/signals/workspace-client.js", async (importOriginal) => {
  const { readyWorkspaceModule } = await import("./test-stubs/workspace-context-ready.js");
  return readyWorkspaceModule(await importOriginal());
});

vi.mock("$lib/signals/graph-signal-detail-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("$lib/signals/graph-signal-detail-client.js")>();
  return {
    ...actual,
    fetchGraphSignalDetail: vi.fn(async (_scope: unknown, citySlug: string) => ({
      citySlug, token: "token", legacyProjection: null, nodes: [], heads: [],
      counts: { total: 0, hidden: 0, visible: 0, selected: 0 },
    })),
    fetchRevealedSignal: vi.fn(),
  };
});

vi.mock("$lib/signals/signal-facets-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("$lib/signals/signal-facets-client.js")>();
  const postFacetCommand = vi.fn(async () => ({ id: "event-1" }));
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
    postFacetCommand,
    // Bound commands go through the mocked transport, scope first.
    bindFacetCommand: (scope: { workspaceId: string }) =>
      (...args: unknown[]) => (postFacetCommand as (...all: unknown[]) => Promise<unknown>)(scope, ...args),
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

import { fetchAllLots } from "$lib/maps/lots-client.js";
import { readyWorkspaceState, setTestWorkspaceState } from "./test-stubs/workspace-context-ready.js";
import { loadSignauxZones } from "$lib/maps/signaux-zones-loader.js";
import { fetchGraphSignalsByCity } from "$lib/signals/graph-signals-by-city-client.js";
import { fetchGraphSignalDetail } from "$lib/signals/graph-signal-detail-client.js";
import {
  fetchCityFacets,
  fetchReasonCodes,
  postFacetCommand,
} from "$lib/signals/signal-facets-client.js";

const CODES = [
  { code: "P-DENSITE", verdict: "pertinent" },
  { code: "N-ADMIN", verdict: "non_pertinent" },
];

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

function classification(): GraphSignalNode["classification"] {
  return {
    zonage: { valeur: "oui", source: "test", confiance: 0.95 },
    residentiel: { valeur: "oui", source: "test", confiance: 0.9 },
    effet_densifiant: "inconnu",
    instrument: "zonage",
    etape: "avis_motion",
    etapes_historique: ["avis_motion"],
    exclusion_reason: null,
    provenance: { extrait: "" },
    confiance: 0.9,
  } as unknown as GraphSignalNode["classification"];
}

export const NODE_FINGERPRINT = "0123456789abcdef".repeat(4);

function signalNode(citySlug: string, id: string, label: string): GraphSignalNode {
  return {
    id,
    type: "Signal",
    label,
    citySlug,
    sourceRef: `raw/proces-verbaux-ville/cas/${id}.pdf`,
    facetFingerprint: NODE_FINGERPRINT,
    createdAt: "2026-05-19T12:00:00.000Z",
    description: `Synthetic ${label}.`,
    publishedAt: "2026-05-19",
    props: { description: `Synthetic ${label}.` },
    classification: classification(),
  };
}

export const CITY_SLUG = buildCityMapEntries([])[0]!.municipality.slug;
export const OTHER_CITY_SLUG = buildCityMapEntries([])[1]!.municipality.slug;
export const NODES = [
  signalNode(CITY_SLUG, "sig-1", "First zonage signal"),
  signalNode(CITY_SLUG, "sig-2", "Second zonage signal"),
];
export const OTHER_NODES = [
  signalNode(OTHER_CITY_SLUG, "sig-b1", "B first signal"),
  signalNode(OTHER_CITY_SLUG, "sig-b2", "B second signal"),
];

export function setAuth(sub: string | null, status: "pending" | "approved" = "approved", authDisabled = false): void {
  (authStore as unknown as Writable<AuthState>).set({
    loading: false, authenticated: sub !== null, authDisabled, loginBlocked: false,
    user: sub ? { sub, status } : null,
  });
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

export function cityRoute(search: string, slug: string = CITY_SLUG): GeoRoute {
  return { level: "city", citySlug: slug, state: parseGeoQuery(search) };
}

/** Scoped coherent-city answer for one city (no archived target). */
export function detailOf(
  citySlug: string,
  nodes: GraphSignalNode[],
  legacyProjection: GraphSignalDetailResponse["legacyProjection"] = null,
): GraphSignalDetailResponse {
  return {
    citySlug, token: `token-${citySlug}`, legacyProjection, nodes, heads: [],
    counts: { total: nodes.length, hidden: 0, visible: nodes.length, selected: 0 },
  };
}

/** Detail populations answered per city, so city switches change the list. */
export function mockDetailByCity(): void {
  vi.mocked(fetchGraphSignalDetail).mockImplementation(async (_scope, citySlug: string) =>
    detailOf(citySlug, citySlug === OTHER_CITY_SLUG ? OTHER_NODES : NODES));
}

function setSearch(search: string): void {
  window.history.replaceState({}, "", `/geo/city/${CITY_SLUG}${search}`);
}

function mockPopulations(): void {
  vi.mocked(fetchGraphSignalsByCity).mockResolvedValue({
    ok: true,
    totalCount: 2,
    cities: [{ citySlug: CITY_SLUG, signalCount: 2, subsetCounts: {} }],
  });
  vi.mocked(fetchGraphSignalDetail).mockResolvedValue(detailOf(CITY_SLUG, NODES));
}

afterEach(() => {
  cleanup();
  setSearch("");
  localStorage.clear();
});

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  setAuth("tester-1");
  setTestWorkspaceState(readyWorkspaceState());
  vi.mocked(fetchGraphSignalsByCity).mockReset();
  vi.mocked(fetchGraphSignalDetail).mockReset();
  vi.mocked(fetchCityFacets).mockReset();
  vi.mocked(fetchReasonCodes).mockReset();
  vi.mocked(postFacetCommand).mockReset();
  mockPopulations();
  vi.mocked(fetchReasonCodes).mockResolvedValue({ profileId: "immo-steve-2026-09", codes: CODES });
  vi.mocked(fetchCityFacets).mockResolvedValue({ heads: [] });
  vi.mocked(postFacetCommand).mockResolvedValue({ id: "event-1" });
  vi.mocked(fetchAllLots).mockClear();
  vi.mocked(loadSignauxZones).mockClear();
});

export async function openFirstSignalCard(): Promise<void> {
  await screen.findByRole("button", { name: /First zonage signal/ });
  await fireEvent.click(screen.getByRole("button", { name: /First zonage signal/ }));
  await screen.findByTestId("signal-facet-controls");
}
