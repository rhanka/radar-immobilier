/**
 * SignauxMapView — classement behaviour (F6): a discard driven through the
 * real view removes the card at once and decrements the selected city;
 * a failed write is visible and keeps the card; an in-flight write disables
 * its menu. Clients are mocked — no WebGL, no API.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, waitFor, screen, fireEvent, within } from "@testing-library/svelte";
import { buildCityMapEntries } from "$lib/maps/maps-data.js";
import { parseGeoQuery, type GeoRoute } from "$lib/router/geo-route.js";

vi.mock("$lib/components/maps/GeoCityMapBase.svelte", async () => {
  const stub = await import("./test-stubs/GeoCityMapBaseStub.svelte");
  return { default: stub.default };
});
vi.mock("$lib/maps/geo-sat-basemap.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/maps/geo-sat-basemap.js")>();
  return { ...actual, isSatelliteBasemapEnabled: () => true };
});
vi.mock("$lib/signals/graph-signals-by-city-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/signals/graph-signals-by-city-client.js")>();
  return { ...actual, fetchGraphSignalsByCity: vi.fn(async () => ({ cities: [] })) };
});
vi.mock("$lib/signals/graph-signal-detail-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/signals/graph-signal-detail-client.js")>();
  return { ...actual, fetchGraphSignalDetail: vi.fn() };
});
vi.mock("$lib/signals/signal-classement-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/signals/signal-classement-client.js")>();
  return {
    ...actual,
    fetchReasonCodes: vi.fn(async () => [
      { code: "P-DENSITE", verdict: "pertinent" as const, label: "densité" },
      { code: "S-PLANIFIE", verdict: "a_surveiller" as const, label: "planifié" },
      { code: "N-NON-RES", verdict: "non_pertinent" as const, label: "non résidentiel" },
    ]),
    applyClassement: vi.fn(),
  };
});
vi.mock("$lib/signals/workspace-client.js", async (importOriginal) => {
  const { readyWorkspaceModule } = await import("./test-stubs/workspace-context-ready.js");
  return readyWorkspaceModule(await importOriginal());
});
vi.mock("$lib/maps/signaux-zones-loader.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/maps/signaux-zones-loader.js")>();
  return {
    ...actual,
    loadSignauxZones: vi.fn(async (citySlug: string) => ({
      tier: "collection" as const,
      response: {
        ok: true, citySlug, source: "official", resolutionStatus: "official",
        geometryStatus: "official", zoneCount: 0, warnings: [],
        featureCollection: { type: "FeatureCollection" as const, features: [] },
      },
    })),
  };
});
vi.mock("$lib/maps/cptaq-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/maps/cptaq-client.js")>();
  return { ...actual, fetchCptaqConstraints: vi.fn(async () => ({ ok: false, absent: true, featureCollection: { type: "FeatureCollection" as const, features: [] } })) };
});
vi.mock("$lib/maps/lots-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/maps/lots-client.js")>();
  return {
    ...actual,
    fetchAllLots: vi.fn(async (citySlug: string) => ({
      ok: true, citySlug, source: "donnees-quebec" as const,
      collectionId: actual.lotsCollectionId(citySlug), numberMatched: 0, numberReturned: 0,
      featureCollection: { type: "FeatureCollection" as const, features: [] },
    })),
  };
});

import SignauxMapView from "./SignauxMapView.svelte";
import { fetchGraphSignalDetail, GraphSignalsHttpError } from "$lib/signals/graph-signal-detail-client.js";
import { applyClassement } from "$lib/signals/signal-classement-client.js";

const CITY_SLUG = buildCityMapEntries([])[0]!.municipality.slug;
const FINGERPRINT = "a".repeat(64);

function node(id: string, label: string) {
  return {
    id, type: "Signal", label, citySlug: CITY_SLUG, sourceRef: null,
    facetFingerprint: FINGERPRINT,
    createdAt: "2026-05-19T12:00:00.000Z", publishedAt: "2026-05-19T12:00:00.000Z",
    props: {},
    classification: {
      zonage: { valeur: "oui", source: "test", confiance: 0.95 },
      residentiel: { valeur: "oui", source: "test", confiance: 0.9 },
      effet_densifiant: "inconnu", instrument: "rezonage", etape: "avis_motion",
      etapes_historique: ["avis_motion"], exclusion_reason: null,
      provenance: { extrait: "" }, confiance: 0.9,
    },
  };
}
const SIG1 = node("sig-1", "Signal un");
const SIG2 = node("sig-2", "Signal deux");
let discarded = false;
let surveille = false;

function detailResult() {
  return {
    citySlug: CITY_SLUG, token: "token", legacyProjection: null,
    nodes: discarded ? [SIG2] : [SIG1, SIG2],
    selection: surveille
      ? [{ target: { citySlug: CITY_SLUG, type: "Signal", id: "sig-2" }, facet: "selection", basket: "a_surveiller", state: "active", reasonCode: "S-PLANIFIE", id: "a_surveiller-sig-2" }]
      : [], heads: [],
    counts: { total: 2, hidden: discarded ? 1 : 0, visible: discarded ? 1 : 2, selected: 0 },
  };
}
function cityRoute(): GeoRoute {
  return { level: "city", citySlug: CITY_SLUG, state: parseGeoQuery(window.location.search) };
}
function card(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-signal-node="${id}"]`);
  expect(el, `card ${id}`).toBeTruthy();
  return el!;
}

beforeEach(() => {
  discarded = false;
  surveille = false;
  window.history.replaceState({}, "", `/geo/city/${CITY_SLUG}?mode=signal&filter.period=all`);
  vi.mocked(fetchGraphSignalDetail).mockReset();
  vi.mocked(fetchGraphSignalDetail).mockImplementation(async () => detailResult() as never);
  vi.mocked(applyClassement).mockReset();
});
afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  localStorage.clear();
});

describe("SignauxMapView classement behaviour", () => {
  it("discard through the view removes the card and decrements the city", async () => {
    vi.mocked(applyClassement).mockImplementation(async () => { discarded = true; });
    render(SignauxMapView, { props: { geoRoute: cityRoute() } });
    await waitFor(() => expect(document.querySelectorAll("[data-signal-node]").length).toBe(2));
    expect(document.querySelector('[aria-label="2 signaux"]')).toBeTruthy();

    const scope = within(card("sig-1"));
    // Icon lives in the card header row, aligned with the title head.
    const classementBtn = scope.getByTestId("signal-classement-button");
    expect(classementBtn.closest(".sel-entity-head-row")).toBeTruthy();
    expect(classementBtn.closest(".sel-entity-head-row")?.querySelector(".sel-entity-head")).toBeTruthy();
    await fireEvent.click(classementBtn);
    await fireEvent.click(screen.getByTestId("classement-class-ecarte"));
    await fireEvent.click(screen.getByTestId("classement-reason-N-NON-RES"));

    await waitFor(() => expect(document.querySelector('[data-signal-node="sig-1"]')).toBeNull());
    expect(document.querySelector('[data-signal-node="sig-2"]')).toBeTruthy();
    await waitFor(() => expect(document.querySelector('[aria-label="1 signaux"]')).toBeTruthy());
    expect(vi.mocked(applyClassement)).toHaveBeenCalledTimes(1);
  });

  it("classifying À surveiller with a reason shows the reason chip on the card", async () => {
    vi.mocked(applyClassement).mockImplementation(async () => { surveille = true; });
    render(SignauxMapView, { props: { geoRoute: cityRoute() } });
    await waitFor(() => expect(document.querySelectorAll("[data-signal-node]").length).toBe(2));
    const scope = within(card("sig-2"));
    await fireEvent.click(scope.getByTestId("signal-classement-button"));
    await fireEvent.click(screen.getByTestId("classement-class-a_surveiller"));
    await fireEvent.click(screen.getByTestId("classement-reason-S-PLANIFIE"));
    await waitFor(() => {
      const chip = within(card("sig-2")).getByTestId("classement-reason-chip");
      expect(chip.textContent).toContain("S-PLANIFIE");
      expect(chip.textContent).toContain("planifié");
    });
  });

  it("a failed write shows a visible error and keeps the card", async () => {
    vi.mocked(applyClassement).mockRejectedValue(
      new GraphSignalsHttpError("classement discard: 409", 409, "facet_head_conflict"));
    render(SignauxMapView, { props: { geoRoute: cityRoute() } });
    await waitFor(() => expect(document.querySelectorAll("[data-signal-node]").length).toBe(2));

    const scope = within(card("sig-1"));
    await fireEvent.click(scope.getByTestId("signal-classement-button"));
    await fireEvent.click(screen.getByTestId("classement-class-ecarte"));
    await fireEvent.click(screen.getByTestId("classement-reason-N-NON-RES"));

    const alert = await screen.findByTestId("classement-error");
    expect(alert.textContent).toContain("409");
    expect(document.querySelector('[data-signal-node="sig-1"]')).toBeTruthy();
  });

  it("disables the node's menu while its write is in flight", async () => {
    let release!: () => void;
    vi.mocked(applyClassement).mockImplementation(
      () => new Promise<void>((resolve) => { release = resolve; }));
    render(SignauxMapView, { props: { geoRoute: cityRoute() } });
    await waitFor(() => expect(document.querySelectorAll("[data-signal-node]").length).toBe(2));

    const scope = within(card("sig-2"));
    await fireEvent.click(scope.getByTestId("signal-classement-button"));
    await fireEvent.click(screen.getByTestId("classement-class-pertinent"));
    await fireEvent.click(screen.getByTestId("classement-reason-none"));

    await waitFor(() => {
      const btn = within(card("sig-2")).getByTestId("signal-classement-button") as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
    // The other node's menu stays enabled.
    const other = within(card("sig-1")).getByTestId("signal-classement-button") as HTMLButtonElement;
    expect(other.disabled).toBe(false);
    release();
  });
});
