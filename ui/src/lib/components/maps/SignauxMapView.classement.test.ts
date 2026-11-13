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
import { countVivierClassifications } from "@radar/domain";

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
    // No label from the API: the UI dictionary supplies the readable text.
    fetchReasonCodes: vi.fn(async () => [
      { code: "P-DENSITE", verdict: "pertinent" as const },
      { code: "S-PLANIFIE", verdict: "a_surveiller" as const },
      { code: "N-NON-RES", verdict: "non_pertinent" as const },
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
import { fetchGraphSignalsByCity } from "$lib/signals/graph-signals-by-city-client.js";

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
const SIG3 = {
  ...node("sig-3", "Signal tardif"),
  classification: {
    zonage: { valeur: "oui", source: "test", confiance: 0.95 },
    residentiel: { valeur: "oui", source: "test", confiance: 0.9 },
    effet_densifiant: "inconnu", instrument: "rezonage", etape: "adoption",
    etapes_historique: ["adoption"], exclusion_reason: null,
    provenance: { extrait: "" }, confiance: 0.9,
  },
};
let discarded = false;
let surveille = false;
let includeLate = false;

function detailResult() {
  const base = discarded ? [SIG2] : [SIG1, SIG2];
  return {
    citySlug: CITY_SLUG, token: "token", legacyProjection: null,
    nodes: includeLate ? [...base, SIG3] : base,
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
  // jsdom has no scrollIntoView; SelPanel scrolls the hovered fiche into view.
  HTMLElement.prototype.scrollIntoView = vi.fn();
  discarded = false;
  surveille = false;
  includeLate = false;
  window.history.replaceState({}, "", `/geo/city/${CITY_SLUG}?mode=signal&filter.period=all`);
  vi.mocked(fetchGraphSignalDetail).mockReset();
  vi.mocked(fetchGraphSignalDetail).mockImplementation(async () => detailResult() as never);
  vi.mocked(applyClassement).mockReset();
  vi.mocked(fetchGraphSignalsByCity).mockReset();
  vi.mocked(fetchGraphSignalsByCity).mockImplementation(async () => {
    const { nodes } = detailResult();
    return { ok: true, totalCount: nodes.length, cities: [{
      citySlug: CITY_SLUG, signalCount: nodes.length, subsetCounts: {},
      vivierV2Counts: countVivierClassifications(nodes.map((node) => node.classification as never)),
    }] };
  });
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
    await fireEvent.click(screen.getByRole("menuitem", { name: "Écarté" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "Non résidentiel" }));

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
    await fireEvent.click(screen.getByRole("menuitem", { name: "À surveiller" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "Changement planifié" }));
    await waitFor(() => {
      const chip = within(card("sig-2")).getByTestId("classement-reason-chip");
      expect(chip.textContent).not.toContain("S-PLANIFIE");
      expect(chip.getAttribute("title")).toBe("S-PLANIFIE");
      expect(chip.textContent).toContain("Changement planifié");
    });
  });

  it("filter change → counts updated: unchecking Précoce recomputes Pertinence and Filtre pills", async () => {
    includeLate = true;
    vi.mocked(fetchGraphSignalsByCity).mockResolvedValue({ ok: true, totalCount: 3, cities: [{
      citySlug: CITY_SLUG, signalCount: 3, subsetCounts: {},
      filtreCube: { "11100": 2, "11000": 1 },
      filtreCubesByClassement: { pertinent: {}, a_surveiller: {}, non_classe: { "11100": 2, "11000": 1 }, ecarte: {} },
    }] });
    // Authoritative snapshot with every Filtre axis/exclusion checked, so
    // Précoce really filters (a bare `filter.period=all` link unchecks all).
    window.history.replaceState({}, "", `/geo/city/${CITY_SLUG}?mode=signal&filter.period=all&filter.zonage=1&filter.residentiel=1&filter.precoce=1&filter.excludePiia=1&filter.excludeDerogations=1`);
    render(SignauxMapView, { props: { geoRoute: cityRoute() } });
    // Précoce checked: the late signal is filtered out (2 cards).
    await waitFor(() => expect(document.querySelectorAll("[data-signal-node]").length).toBe(2));

    const pills = (testid: string): string[] => {
      const panel = screen.getByTestId(testid);
      return [...panel.querySelectorAll(".st-badge")].map((pill) => pill.textContent?.trim() ?? "");
    };
    // Pertinence counts AFTER Filtre: Non classé = 2 (late node excluded).
    await fireEvent.click(screen.getByTestId("classement-filter-trigger"));
    expect(pills("classement-filter-panel")).toEqual(["0", "0", "2", "0"]);
    await fireEvent.click(screen.getByTestId("classement-filter-trigger"));

    // Faceted Filtre pills: each criterion over the signals the OTHER active
    // criteria keep. Précoce checked: Zonage / Résidentiel read the 2 shown.
    await fireEvent.click(screen.getByTestId("filtre-trigger"));
    expect(pills("filtre-panel")).toEqual(["2", "2", "2", "0", "0"]);
    // Uncheck Précoce: the late signal shows (3 cards), Zonage / Résidentiel
    // follow, and Précoce keeps counting the 2 early signals.
    const precoceBox = screen.getByLabelText(/Précoce/) as HTMLInputElement;
    await fireEvent.click(precoceBox);
    await waitFor(() => expect(document.querySelectorAll("[data-signal-node]").length).toBe(3));
    expect(pills("filtre-panel")).toEqual(["3", "3", "2", "0", "0"]);
    await fireEvent.click(screen.getByTestId("filtre-trigger"));
    await fireEvent.click(screen.getByTestId("classement-filter-trigger"));
    expect(pills("classement-filter-panel")).toEqual(["0", "0", "3", "0"]);
  });

  it.each([false, true])("should apply Pertinence to every city's Filtre pills (selection: %s)", async (selected) => {
    includeLate = true;
    vi.mocked(fetchGraphSignalDetail).mockImplementation(async () => ({
      ...detailResult(), nodes: [...detailResult().nodes, {
        ...node("derog", "Dérogation mineure — quatre logements"),
        classification: { ...SIG1.classification, instrument: "derogation" },
      }],
    }) as never);
    const [cityA, cityB] = buildCityMapEntries([]).map((entry) => entry.municipality.slug);
    const stages = (early: number, late = 0) => ({
      avis_motion: early, projet_reglement: 0, consultation_publique: 0, second_projet: 0,
      adoption: late, entree_vigueur: 0, inconnu: 0,
    });
    const empty = stages(0);
    const counts = (early: number, late: number, excluded: number) => ({
      qualified: early + late, residentialUnknown: excluded,
      excludedByReason: { non_residentiel_franc: 0, piia_non_pertinent: 0, hors_zonage: 0, derogation_hors_sujet: 0 },
      stageCounts: stages(early, late), stageCountsHorsZonage: empty,
      stageCountsResEligible: stages(early, late), stageCountsResEligibleHorsZonage: empty,
      total: early + late + excluded,
    });
    vi.mocked(fetchGraphSignalsByCity).mockImplementation(async () => ({
      ok: true, totalCount: 7,
      cities: [
        // A: 2 early shown, 1 late, 1 early derogation hidden by its exclusion.
        { citySlug: cityA!, signalCount: 4, subsetCounts: {}, vivierV2Counts: counts(2, 1, 0),
          filtreCube: { "11100": 2, "11000": 1, "11101": 1 },
          filtreCubesByClassement: { pertinent: {}, a_surveiller: {}, ecarte: {},
            non_classe: { "11100": 2, "11000": 1, "11101": 1 } } },
        // B: 1 early shown, 2 early PIIA without a residential project hidden.
        { citySlug: cityB!, signalCount: 3, subsetCounts: {}, vivierV2Counts: counts(1, 0, 0),
          filtreCube: { "11100": 1, "11110": 2 },
          filtreCubesByClassement: { pertinent: {}, a_surveiller: {}, ecarte: {},
            non_classe: { "11100": 1, "11110": 2 } } },
      ],
    }) as never);
    window.history.replaceState({}, "", "/geo/region/quebec?mode=signal&filter.period=all&filter.zonage=1&filter.residentiel=1&filter.precoce=1&filter.excludePiia=1&filter.excludeDerogations=1");
    render(SignauxMapView, { props: { geoRoute: selected ? cityRoute() : {
      level: "region", region: "quebec", state: parseGeoQuery(window.location.search),
    } } });
    // Rail header « 3 signaux · 2 villes » (bulk counts, no selection).
    await waitFor(() => expect([...document.querySelectorAll(".rail-count-strong")]
      .map((el) => el.textContent)).toEqual(["3", "2"]));
    if (!selected) expect(vi.mocked(fetchGraphSignalDetail)).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByTestId("filtre-trigger"));
    const pills = () => [...screen.getByTestId("filtre-panel").querySelectorAll(".st-badge")]
      .map((pill) => pill.textContent?.trim() ?? "");
    // Zonage / Résidentiel / Précoce = the 3 signals shown; PIIA hides 2; dérogations hide 1.
    expect(pills()).toEqual(["3", "3", "3", "2", "1"]);
    // The counts follow the other active criteria: without Précoce, the late signal joins.
    await fireEvent.click(screen.getByLabelText(/Précoce/));
    await waitFor(() => expect(pills()).toEqual(["4", "4", "3", "2", "1"]));
    await fireEvent.click(screen.getByTestId("classement-filter-trigger"));
    const panel = within(screen.getByTestId("classement-filter-panel"));
    for (const box of panel.getAllByRole("checkbox")) {
      if ((box as HTMLInputElement).checked) await fireEvent.click(box);
    }
    await fireEvent.click(screen.getByTestId("filtre-trigger"));
    await waitFor(() => expect(pills()).toEqual(["0", "0", "0", "0", "0"]));
    // A non-empty Pertinence selection must also filter the other cities.
    await fireEvent.click(screen.getByTestId("classement-filter-trigger"));
    await fireEvent.click(within(screen.getByTestId("classement-filter-panel")).getByLabelText(/^Pertinent/));
    await fireEvent.click(screen.getByTestId("filtre-trigger"));
    expect(pills()).toEqual(["0", "0", "0", "0", "0"]);
  });

  it("a failed write marks only the concerned card with an exclamation icon, no big panel", async () => {
    vi.mocked(applyClassement).mockRejectedValue(
      new GraphSignalsHttpError("classement discard: 409", 409, "facet_head_conflict"));
    render(SignauxMapView, { props: { geoRoute: cityRoute() } });
    await waitFor(() => expect(document.querySelectorAll("[data-signal-node]").length).toBe(2));

    const scope = within(card("sig-1"));
    await fireEvent.click(scope.getByTestId("signal-classement-button"));
    await fireEvent.click(screen.getByRole("menuitem", { name: "Écarté" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "Non résidentiel" }));

    // No panel-level error any more; the concerned card carries the icon.
    const icon = await within(card("sig-1")).findByTestId("classement-error-icon");
    expect(icon.getAttribute("title")).toContain("409");
    expect(within(card("sig-2")).queryByTestId("classement-error-icon")).toBeNull();
    expect(screen.queryByTestId("classement-error")).toBeNull();
    expect(document.querySelector('[data-signal-node="sig-1"]')).toBeTruthy();
    // Click reveals the detail at normal size.
    await fireEvent.click(icon);
    const detail = await within(card("sig-1")).findByTestId("classement-error-detail");
    expect(detail.textContent).toContain("409");
  });

  it("the exclamation icon disappears on the next successful write", async () => {
    vi.mocked(applyClassement)
      .mockRejectedValueOnce(new GraphSignalsHttpError("classement select: 409", 409, "facet_head_conflict"))
      .mockResolvedValue(undefined);
    render(SignauxMapView, { props: { geoRoute: cityRoute() } });
    await waitFor(() => expect(document.querySelectorAll("[data-signal-node]").length).toBe(2));

    const scope = within(card("sig-1"));
    await fireEvent.click(scope.getByTestId("signal-classement-button"));
    await fireEvent.click(screen.getByRole("menuitem", { name: "Pertinent" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "Sans motif" }));
    await within(card("sig-1")).findByTestId("classement-error-icon");

    await fireEvent.click(within(card("sig-1")).getByTestId("signal-classement-button"));
    await fireEvent.click(screen.getByRole("menuitem", { name: "Pertinent" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "Sans motif" }));
    await waitFor(() => expect(within(card("sig-1")).queryByTestId("classement-error-icon")).toBeNull());
  });

  it("disables the node's menu while its write is in flight", async () => {
    let release!: () => void;
    vi.mocked(applyClassement).mockImplementation(
      () => new Promise<void>((resolve) => { release = resolve; }));
    render(SignauxMapView, { props: { geoRoute: cityRoute() } });
    await waitFor(() => expect(document.querySelectorAll("[data-signal-node]").length).toBe(2));

    const scope = within(card("sig-2"));
    await fireEvent.click(scope.getByTestId("signal-classement-button"));
    await fireEvent.click(screen.getByRole("menuitem", { name: "Pertinent" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "Sans motif" }));

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
