import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, screen, waitFor } from "@testing-library/svelte";
import { buildCityMapEntries } from "$lib/maps/maps-data.js";
import { parseGeoQuery, type GeoRoute } from "$lib/router/geo-route.js";
import type { GraphSignalNode } from "$lib/signals/graph-signal-detail-client.js";
import type { GeoZonesResponse } from "$lib/maps/geo-zones-client.js";
import { rebuildSignalEvidence } from "$lib/signals/pdf-overlay-signals.js";

vi.mock("$lib/components/maps/GeoCityMapBase.svelte", async () => {
  const stub = await import("./test-stubs/GeoCityMapBaseStub.svelte");
  return { default: stub.default };
});

vi.mock("$lib/maps/geo-sat-basemap.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("$lib/maps/geo-sat-basemap.js")>();
  return { ...actual, isSatelliteBasemapEnabled: () => true };
});

vi.mock("$lib/signals/graph-signals-by-city-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("$lib/signals/graph-signals-by-city-client.js")>();
  return {
    ...actual,
    fetchGraphSignalsByCity: vi.fn(async () => ({ cities: [] })),
  };
});

vi.mock("$lib/signals/graph-signal-detail-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("$lib/signals/graph-signal-detail-client.js")>();
  return {
    ...actual,
    fetchGraphSignalDetail: vi.fn(async (_scope: unknown, citySlug: string) => ({
      citySlug,
      token: "token",
      legacyProjection: null,
      nodes: [],
      heads: [],
      counts: { total: 0, hidden: 0, visible: 0, selected: 0 },
    })),
  };
});

vi.mock("$lib/signals/workspace-client.js", async (importOriginal) => {
  const { readyWorkspaceModule } = await import("./test-stubs/workspace-context-ready.js");
  return readyWorkspaceModule(await importOriginal());
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
  const actual =
    await importOriginal<typeof import("$lib/maps/cptaq-client.js")>();
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
  const actual =
    await importOriginal<typeof import("$lib/maps/lots-client.js")>();
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

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({ promise: new Promise(() => {}) }),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "/worker.mjs" }));

vi.mock("$lib/signals/pdf-overlay-signals.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("$lib/signals/pdf-overlay-signals.js")>();
  return { ...actual, rebuildSignalEvidence: vi.fn(actual.rebuildSignalEvidence) };
});

import SignauxMapView from "./SignauxMapView.svelte";
import { fetchGraphSignalDetail } from "$lib/signals/graph-signal-detail-client.js";
import { fetchGraphSignalsByCity } from "$lib/signals/graph-signals-by-city-client.js";

const CITY_SLUG = buildCityMapEntries([])[0]!.municipality.slug;

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

function signalNode(citySlug: string, id: string, label: string): GraphSignalNode {
  return {
    id,
    type: "Signal",
    label,
    citySlug,
    sourceRef: "raw/6d/shared.pdf",
    createdAt: "2026-05-19T12:00:00Z",
    description: `Synthetic ${label}.`,
    publishedAt: "2026-05-19",
    props: {
      description: `Synthetic ${label}.`,
      excerpt: "Le conseil approuve le zonage residentiel.",
      page: 1,
      rawRef: "raw/6d/shared.pdf",
    },
    classification: classification(),
  };
}

function cityRoute(): GeoRoute {
  return {
    level: "city",
    citySlug: CITY_SLUG,
    state: parseGeoQuery("?filter.period=all"),
  };
}

function detailOf(citySlug: string, nodes: GraphSignalNode[]) {
  return {
    citySlug,
    token: `token-${citySlug}`,
    legacyProjection: null,
    nodes,
    heads: [],
    counts: { total: nodes.length, hidden: 0, visible: nodes.length, selected: 0 },
  };
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(fetchGraphSignalsByCity).mockResolvedValue({
    ok: true,
    totalCount: 2,
    cities: [{ citySlug: CITY_SLUG, signalCount: 2, subsetCounts: {} }],
  } as unknown as Awaited<ReturnType<typeof fetchGraphSignalsByCity>>);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("SignauxMapView — evidence follows refreshed nodes while dialog stays open", () => {
  it("rebuilds open evidence on display-exclusion change without closing the dialog", async () => {
    const served = [signalNode(CITY_SLUG, "sig-1", "First zonage signal"), signalNode(CITY_SLUG, "sig-2", "Second zonage signal")];
    vi.mocked(fetchGraphSignalDetail).mockResolvedValue(detailOf(CITY_SLUG, served));

    render(SignauxMapView, { props: { geoRoute: cityRoute() } });

    await screen.findByRole("button", { name: /First zonage signal/ });
    await fireEvent.click(screen.getByRole("button", { name: /First zonage signal/ }));
    await fireEvent.click(screen.getByRole("button", { name: /Voir la preuve/ }));
    await screen.findByRole("dialog", { name: "Preuve documentaire" });

    vi.mocked(rebuildSignalEvidence).mockClear();

    // Another trigger than the retired triage toggle: the B display exclusion
    // (inside the closed-by-default Filtre dropdown panel).
    if (!screen.queryByTestId("filtre-panel")) await fireEvent.click(screen.getByTestId("filtre-trigger"));
    await fireEvent.click(screen.getByLabelText("Exclure PIIA sans projet résidentiel"));

    await waitFor(() => expect(vi.mocked(rebuildSignalEvidence)).toHaveBeenCalled());
    expect(screen.getByRole("dialog", { name: "Preuve documentaire" })).toBeTruthy();
    const rebuilt = vi.mocked(rebuildSignalEvidence).mock.results.at(-1)!.value;
    expect(rebuilt.signals.map((signal: { id: string }) => signal.id)).toEqual(
      expect.arrayContaining(["sig-1", "sig-2"]),
    );
  });
});
