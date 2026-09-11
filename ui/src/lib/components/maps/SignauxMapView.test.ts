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
import { render, cleanup, waitFor, screen, fireEvent, within } from "@testing-library/svelte";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

  it("should hide the Lots legend when the displayed collection is empty", async () => {
    setSearch("");
    render(SignauxMapView, { props: { geoRoute: cityRoute() } });

    await waitFor(() => expect(vi.mocked(fetchAllLots)).toHaveBeenCalled());
    expect(screen.queryByTestId("map-legend-lots")).toBeNull();
  });

  it("should show only winning lot categories present in displayedLots", async () => {
    vi.mocked(fetchAllLots).mockResolvedValueOnce({
      ok: true,
      citySlug: CITY_SLUG,
      source: "donnees-quebec",
      collectionId: `qc-lots-${CITY_SLUG}`,
      numberMatched: 2,
      numberReturned: 2,
      featureCollection: {
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: null, properties: { noLot: "1", priorite: true } },
          { type: "Feature", geometry: null, properties: { noLot: "2", tod: true } },
        ],
      },
    });
    setSearch("");
    render(SignauxMapView, { props: { geoRoute: cityRoute() } });

    const legend = await screen.findByTestId("map-legend-lots");
    const queries = within(legend);
    expect(queries.getByText("Priorité (4+ ∧ TOD)")).toBeTruthy();
    expect(queries.getByText("Périmètre TOD")).toBeTruthy();
    expect(queries.queryByText("Multifamilial 4+")).toBeNull();
    expect(queries.queryByText("Sans indicateur")).toBeNull();
    expect(queries.queryByText("Zone citée par un signal")).toBeNull();

    for (const label of ["N° de zone", "N° de lot"]) {
      const checkboxLabel = screen.getByLabelText(label).closest("label");
      expect(checkboxLabel?.classList.contains("text-xs")).toBe(true);
      expect(checkboxLabel?.classList.contains("text-slate-600")).toBe(true);
    }
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

  it("should render a single agricultural entry when the CPTAQ toggle is shown", async () => {
    const response = fixtureZones(CITY_SLUG);
    response.featureCollection.features[0]!.properties.kind = "agricole";
    vi.mocked(loadSignauxZones).mockResolvedValueOnce({ tier: "collection", response });
    setSearch("");
    render(SignauxMapView, { props: { geoRoute: cityRoute() } });

    const legend = await screen.findByTestId("map-legend-zonage");
    expect(within(legend).getByText("Agricole (CPTAQ)")).toBeTruthy();
    expect(within(legend).queryByText("Agricole", { exact: true })).toBeNull();
    expect(within(legend).queryByText("Affectation (source)")).toBeNull();
  });

  it("(deux modes) préférence 'satellite' persistée : le mode défaut reste 'plan', le deep-link ville charge zones + lots (harness inchangé)", async () => {
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
    // Exigence owner : défaut TOUJOURS Plan, même avec une préférence 'satellite'
    // persistée (jamais restaurée comme défaut au chargement).
    const stub = document.querySelector("[data-testid='stub-map']");
    expect(stub?.getAttribute("data-basemap-mode")).toBe("plan");
    localStorage.clear();
  });
});

/**
 * §5 R2 point 2 — GUARD de câblage du DÉCLENCHEUR CHAT (lecture SOURCE).
 *
 * Le rendu réel du bouton passe par le slot terminal `controls-bottom-right-end`
 * du VRAI socle GeoCityMapBase ; or les tests d'intégration ci-dessus stubent le
 * socle (`GeoCityMapBaseStub`, qui n'expose pas ce slot) et maplibre est indispo
 * en jsdom. On lit donc la SOURCE et on prouve que le câblage est en place ;
 * l'interaction visuelle (position « tout à droite », ouverture) est couverte en
 * e2e / recette owner. Pur : aucun composant monté, aucun réseau.
 */
describe("SignauxMapView — déclencheur chat (câblage source, store #564)", () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(resolve(HERE, "./SignauxMapView.svelte"), "utf8");

  it("remplit le slot terminal `controls-bottom-right-end` du socle", () => {
    expect(source).toContain('slot="controls-bottom-right-end"');
  });

  it("bouton = IconButton DS carré (sm/secondary) + glyph lucide MessageSquare", () => {
    expect(source).toContain("IconButton");
    // Bulle DANS un carré : glyph rendu = <MessageSquare>, JAMAIS <MessageCircle>.
    expect(source).toContain("<MessageSquare");
    expect(source).not.toContain("<MessageCircle");
    expect(source).toMatch(/size="sm"/);
    expect(source).toMatch(/variant="secondary"/);
  });

  it("ARIA dialog + état ouvert reflété, clic → requestChatToggle (store #564)", () => {
    expect(source).toContain('aria-haspopup="dialog"');
    expect(source).toContain('aria-controls="chat-dock-dialog"');
    expect(source).toContain("aria-expanded={chatOpen}");
    expect(source).toContain("requestChatToggle()");
    // L'état ouvert est LU depuis le layout publié par le dock (pas dupliqué).
    expect(source).toContain("$chatWidgetLayout.isOpen");
  });

  // ── GATE feature-flag (décision owner 2026-09-07) ──────────────────────────
  // Le déclencheur (tout le câblage Lot 2 ci-dessus) est GARDÉ mais GATÉ par le
  // flag chat : OFF par défaut ⇒ le bouton n'est pas rendu. Le rendu réel du slot
  // n'est atteignable qu'avec le VRAI socle (stubé ici) → on prouve le GATE en
  // source (parité avec les guards ci-dessus) ; l'ABSENCE réelle quand OFF est
  // vérifiée en unit (ChatWidgetHost.test.ts, état OFF) et en e2e (chat-disabled).
  it("le déclencheur chat est GATÉ par le feature-flag (isChatEnabled, défaut OFF)", () => {
    // Helper flag importé + évalué (constante build-time locale).
    expect(source).toContain('import { isChatEnabled } from "$lib/chat/chat-feature"');
    expect(source).toContain("isChatEnabled()");
    // Le bouton (IconButton chat) est rendu SOUS condition du flag.
    expect(source).toMatch(/\{#if chatEnabled\}[\s\S]*?data-testid="chat-toggle"[\s\S]*?\{\/if\}/);
  });
});
