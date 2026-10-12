import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCityMapEntries } from "$lib/maps/maps-data.js";
import { parseGeoQuery } from "$lib/router/geo-route.js";
import type { GeoZonesResponse } from "$lib/maps/geo-zones-client.js";
import type { FetchAllLotsOptions, LotsResponse } from "$lib/maps/lots-client.js";
import { styleLoadingMaps } from "./test-stubs/StyleLoadingMapLibre.js";

vi.mock("maplibre-gl", async () => ({ default: {
  Map: (await import("./test-stubs/StyleLoadingMapLibre.js")).StyleLoadingMap,
} }));
vi.mock("$lib/maps/geo-sat-basemap.js", async (original) => ({
  ...await original<typeof import("$lib/maps/geo-sat-basemap.js")>(),
  isSatelliteBasemapEnabled: () => false,
}));
vi.mock("$lib/signals/graph-signals-by-city-client.js", async (original) => ({
  ...await original<typeof import("$lib/signals/graph-signals-by-city-client.js")>(),
  fetchGraphSignalsByCity: vi.fn(async () => ({ cities: [] })),
}));
vi.mock("$lib/signals/graph-signal-detail-client.js", async (original) => ({
  ...await original<typeof import("$lib/signals/graph-signal-detail-client.js")>(),
  fetchGraphSignalDetail: vi.fn(async (citySlug: string) => ({ ok: true, citySlug, nodes: [], legacyProjection: null })),
}));
vi.mock("$lib/maps/cptaq-client.js", async (original) => ({
  ...await original<typeof import("$lib/maps/cptaq-client.js")>(),
  fetchCptaqConstraints: vi.fn(async () => ({ ok: false, absent: true })),
}));
vi.mock("$lib/maps/signaux-zones-loader.js", async (original) => ({
  ...await original<typeof import("$lib/maps/signaux-zones-loader.js")>(),
  loadSignauxZones: vi.fn(),
}));
vi.mock("$lib/maps/lots-client.js", async (original) => ({
  ...await original<typeof import("$lib/maps/lots-client.js")>(),
  fetchAllLots: vi.fn(),
}));
import SignauxMapView from "./SignauxMapView.svelte";
import { loadSignauxZones } from "$lib/maps/signaux-zones-loader.js";
import { fetchAllLots } from "$lib/maps/lots-client.js";

const CITY = buildCityMapEntries([])[0]!.municipality.slug;
const geometry = { type: "Polygon" as const, coordinates: [[[-73.55, 45.37], [-73.54, 45.37], [-73.54, 45.38], [-73.55, 45.37]]] };
const zones: GeoZonesResponse = {
  ok: true, citySlug: CITY, source: "official", resolutionStatus: "official", geometryStatus: "official", zoneCount: 1, warnings: [],
  featureCollection: { type: "FeatureCollection", features: [{ type: "Feature", geometry, properties: {
    code: "H-01", citySlug: CITY, geometryStatus: "official", confidence: 1, source: "official-zone", lotCount: 2, lots: [], kind: "habitation",
  } }] },
};
function lots(count = 2): LotsResponse {
  return { ok: true, citySlug: CITY, source: "donnees-quebec", collectionId: `qc-lots-${CITY}`, numberMatched: 2, numberReturned: count,
    featureCollection: { type: "FeatureCollection", features: Array.from({ length: count }, (_, i) => ({
      type: "Feature", geometry, properties: { noLot: `100000${i + 1}`, citySlug: CITY, zoneCode: "H-01" },
    })) } };
}
async function flush(): Promise<void> {
  await vi.dynamicImportSettled();
  for (let i = 0; i < 100; i++) await Promise.resolve();
  await tick();
}
function mountCity(): void {
  render(SignauxMapView, { props: { geoRoute: { level: "city", citySlug: CITY, state: parseGeoQuery("?mode=signal") } } });
}
function expectSettled(): void {
  expect(screen.queryByText("Chargement des zones…")).toBeNull();
  expect(screen.queryByText("Chargement des lots…")).toBeNull();
  expect(screen.queryByText("Zones indisponibles.")).toBeNull();
  expect(screen.queryByText("Lots indisponibles.")).toBeNull();
  for (const [label, count] of [["Zones", 1], ["Lots", 2]] as const) {
    const summary = screen.getByText(label, { selector: "summary span" }).closest("summary");
    expect(summary?.textContent?.replace(/\s+/g, " ").trim()).toBe(`${label} ${count}`);
  }
  const map = styleLoadingMaps[0];
  expect((map.sources.get("selected-zones")!.data as GeoZonesResponse["featureCollection"]).features).toHaveLength(1);
  expect((map.sources.get("selected-lots")!.data as LotsResponse["featureCollection"]).features).toHaveLength(2);
}
beforeEach(() => {
  vi.useFakeTimers();
  styleLoadingMaps.length = 0;
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ type: "FeatureCollection", features: [] }) })));
  vi.mocked(loadSignauxZones).mockReset().mockResolvedValue({ tier: "collection", response: zones });
  vi.mocked(fetchAllLots).mockReset().mockImplementation(async (_city, opts: FetchAllLotsOptions = {}) => {
    opts.onPage?.(lots(1), 0);
    opts.onPage?.(lots(), 1);
    return lots();
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("SignauxMapView with the real map component and delayed style", () => {
  it("should paint already received zones and paginated lots when a delayed style becomes ready", async () => {
    mountCity();
    await flush();
    const map = styleLoadingMaps[0];
    await vi.advanceTimersByTimeAsync(6000);
    await flush();
    expect(map.addSource).not.toHaveBeenCalled();
    expect(screen.queryByText("Lots indisponibles.")).toBeNull();
    map.finishStyle();
    await flush();
    expectSettled();
  });

  it("should paint successive lot pages when the style arrives before the data", async () => {
    let publish!: (count: number) => void;
    let publishZones!: () => void;
    vi.mocked(loadSignauxZones).mockImplementationOnce(() => new Promise((resolve) => {
      publishZones = () => resolve({ tier: "collection", response: zones });
    }));
    vi.mocked(fetchAllLots).mockImplementationOnce((_city, opts = {}) => new Promise((resolve) => {
      publish = (count) => { opts.onPage?.(lots(count), count - 1); if (count === 2) resolve(lots()); };
    }));
    mountCity();
    await flush();
    styleLoadingMaps[0].finishStyle();
    await flush();
    expect(screen.getAllByText("Chargement des zones…").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Chargement des lots…").length).toBeGreaterThan(0);
    publishZones();
    publish(1);
    await flush();
    expect((styleLoadingMaps[0].sources.get("selected-lots")!.data as LotsResponse["featureCollection"]).features).toHaveLength(1);
    publish(2);
    await flush();
    expectSettled();
  });

  it("should leave the loading state after retrying a failed request with a delayed style", async () => {
    vi.mocked(fetchAllLots).mockRejectedValueOnce(new Error("network unavailable"));
    mountCity();
    await flush();
    expect(screen.getAllByText("Lots indisponibles.").length).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(6000);
    await fireEvent.click(screen.getAllByRole("button", { name: "Réessayer" })[0]);
    await flush();
    styleLoadingMaps[0].finishStyle();
    await flush();
    expectSettled();
    expect(fetchAllLots).toHaveBeenCalledTimes(2);
  });
});
