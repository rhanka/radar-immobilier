/**
 * SignauxMapView — deep-link ZONES-ONLY (`?lots=0`).
 *
 * Contrat vérifié (socle carto stubé, clients mockés — aucun WebGL, aucune API) :
 *   (a) avec `?lots=0`, `loadGeoForCity` NE full-fetch PAS les lots (fetchAllLots
 *       non appelé) tout en chargeant les ZONES (loadSignauxZones appelé) ;
 *   (b) sans paramètre, `fetchAllLots` EST appelé (comportement par défaut
 *       STRICTEMENT inchangé).
 *
 * Le deep-link ville est fourni via la prop `geoRoute` (city route) : le réactif
 * `applyGeoRoute` → `selectCity` → `loadGeoForCity` s'enclenche dès que la liste
 * de villes est prête (allEntries dérive de prioritizedCities, donc non vide).
 * Le toggle lots est lu depuis `window.location.search` à l'init du composant.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, waitFor, screen, fireEvent } from "@testing-library/svelte";
import { buildCityMapEntries } from "$lib/maps/maps-data.js";
import {
  normalizeGeoRouteState,
  type GeoRoute,
} from "$lib/router/geo-route.js";
import type { GeoZonesResponse } from "$lib/maps/geo-zones-client.js";

// ── Socle carto stubé (maplibre indisponible en jsdom) ────────────────────────
vi.mock("$lib/components/maps/GeoCityMapBase.svelte", async () => {
  const stub = await import("./test-stubs/GeoCityMapBaseStub.svelte");
  return { default: stub.default };
});

// ── Satellite PERMIS sur ce host (déterministe) : la préférence 'satellite' est
// restaurée quel que soit le hostname jsdom (§6 — harness « dans les deux modes »).
vi.mock("$lib/maps/geo-sat-basemap.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("$lib/maps/geo-sat-basemap.js")>();
  return { ...actual, isSatelliteBasemapEnabled: () => true };
});

// ── Clients réseau mockés (aucun fetch réel) ──────────────────────────────────
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
    fetchGraphSignalDetail: vi.fn(async (citySlug: string) => ({
      ok: true,
      citySlug,
      legacyProjection: null,
      nodes: [],
    })),
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

// §7 R2 — CPTAQ mocké : le clic sur le toggle « Agricole (CPTAQ) » déclenche
// `loadCptaq` → on renvoie une absence propre (aucun fetch réel, aucun WebGL).
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

import SignauxMapView from "./SignauxMapView.svelte";
import { fetchAllLots } from "$lib/maps/lots-client.js";
import { loadSignauxZones } from "$lib/maps/signaux-zones-loader.js";

/** Une zone réelle avec géométrie — le drill zones est alimenté. */
function fixtureZones(citySlug: string): GeoZonesResponse {
  return {
    ok: true,
    citySlug,
    source: "official",
    resolutionStatus: "official",
    geometryStatus: "official",
    zoneCount: 1,
    warnings: [],
    featureCollection: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-73.55, 45.37],
                [-73.54, 45.37],
                [-73.54, 45.38],
                [-73.55, 45.38],
                [-73.55, 45.37],
              ],
            ],
          },
          properties: {
            code: "H-01",
            citySlug,
            geometryStatus: "official",
            confidence: 1,
            source: "official-zone",
            lotCount: 0,
            lots: [],
            kind: "habitation",
          },
        },
      ],
    },
  };
}

/** Slug d'une vraie ville priorisée (garantit la correspondance geoRoute↔entry). */
const CITY_SLUG = buildCityMapEntries([])[0]!.municipality.slug;

function cityRoute(): GeoRoute {
  return {
    level: "city",
    citySlug: CITY_SLUG,
    state: normalizeGeoRouteState({ mode: "signal" }),
  };
}

/** Positionne `window.location.search` (lu à l'init du composant). */
function setSearch(search: string): void {
  window.history.replaceState({}, "", `/geo/city/${CITY_SLUG}${search}`);
}

afterEach(() => {
  cleanup();
  setSearch("");
});

beforeEach(() => {
  vi.mocked(fetchAllLots).mockClear();
  vi.mocked(loadSignauxZones).mockClear();
});

describe("SignauxMapView — deep-link zones-only (?lots=0)", () => {
  it("(a) ?lots=0 : fetchAllLots N'EST PAS appelé, les zones se chargent quand même", async () => {
    setSearch("?lots=0");
    render(SignauxMapView, { props: { geoRoute: cityRoute() } });

    // Preuve que loadGeoForCity a bien tourné pour cette ville : les zones sont
    // chargées. Les deux tâches (zones + lots) sont créées dans le MÊME corps de
    // fonction : si les lots devaient être fetchés, fetchAllLots aurait déjà été
    // appelé au moment où loadSignauxZones l'est. L'assertion est donc fiable.
    await waitFor(() =>
      expect(vi.mocked(loadSignauxZones)).toHaveBeenCalledWith(
        CITY_SLUG,
        expect.anything(),
      ),
    );
    expect(vi.mocked(fetchAllLots)).not.toHaveBeenCalled();
  });

  it("(b) sans paramètre : fetchAllLots EST appelé (défaut inchangé)", async () => {
    setSearch("");
    render(SignauxMapView, { props: { geoRoute: cityRoute() } });

    await waitFor(() =>
      expect(vi.mocked(fetchAllLots)).toHaveBeenCalledWith(
        CITY_SLUG,
        expect.anything(),
      ),
    );
    expect(vi.mocked(loadSignauxZones)).toHaveBeenCalled();
  });

  it("?layers=zones (alias) : fetchAllLots N'EST PAS appelé", async () => {
    setSearch("?layers=zones");
    render(SignauxMapView, { props: { geoRoute: cityRoute() } });

    await waitFor(() =>
      expect(vi.mocked(loadSignauxZones)).toHaveBeenCalled(),
    );
    expect(vi.mocked(fetchAllLots)).not.toHaveBeenCalled();
  });

  // §6 — harness « dans les deux modes » : le fond SATELLITE ne change rien au
  // pipeline Région → Ville → Zone → Lot. La sélection ville (deep-link) pilote
  // les fetchs zones + lots exactement comme en plan ; le mode transmis au socle
  // reste 'satellite'. (Les assertions de PAINT par mode sont couvertes par le
  // socle — GeoCityMapBase.basemap-mode.test.ts — et l'e2e recette.)
  // §7 R2 — refonte légende CPTAQ : encadré autonome retiré, « Agricole (CPTAQ) »
  // devient un TOGGLE de couche sous AFFECTATION (rayé quand désactivé), qui persiste.
  it("(§7) « Agricole (CPTAQ) » = toggle sous AFFECTATION (encadré autonome retiré), rayé puis persisté", async () => {
    setSearch("");
    localStorage.clear();
    render(SignauxMapView, { props: { geoRoute: cityRoute() } });

    // Le toggle apparaît sous AFFECTATION une fois la ville sélectionnée.
    const toggle = await screen.findByTestId("legend-cptaq-toggle");
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.textContent).toContain("Agricole (CPTAQ)");
    // L'encadré autonome + sa case à cocher ont disparu.
    expect(screen.queryByTestId("map-legend-cptaq")).toBeNull();
    // Désactivé par défaut → aria-pressed false + libellé RAYÉ (line-through seul).
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.querySelector(".line-through")).not.toBeNull();

    // Clic → activé + persisté ; la rayure disparaît.
    await fireEvent.click(toggle);
    await waitFor(() =>
      expect(
        screen.getByTestId("legend-cptaq-toggle").getAttribute("aria-pressed"),
      ).toBe("true"),
    );
    // Persistance CPTAQ = "1"/"0" (readLabelPref/persistLabelPref, inchangé).
    expect(localStorage.getItem("signaux-cptaq-enabled")).toBe("1");
    expect(
      screen.getByTestId("legend-cptaq-toggle").querySelector(".line-through"),
    ).toBeNull();
    localStorage.clear();
  });

  it("(deux modes) préférence 'satellite' : le deep-link ville charge zones + lots (harness inchangé)", async () => {
    localStorage.setItem("signaux-basemap-mode", "satellite");
    setSearch("");
    render(SignauxMapView, { props: { geoRoute: cityRoute() } });

    await waitFor(() =>
      expect(vi.mocked(fetchAllLots)).toHaveBeenCalledWith(
        CITY_SLUG,
        expect.anything(),
      ),
    );
    expect(vi.mocked(loadSignauxZones)).toHaveBeenCalledWith(
      CITY_SLUG,
      expect.anything(),
    );
    const stub = document.querySelector("[data-testid='stub-map']");
    expect(stub?.getAttribute("data-basemap-mode")).toBe("satellite");
    localStorage.clear();
  });
});
