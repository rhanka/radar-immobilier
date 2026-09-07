/**
 * SignauxMapView — §5 2-modes : FOND de carte (PLAN défaut / SATELLITE switchable).
 *
 * Contrat vérifié (socle carto stubé — le stub reflète le mode reçu en
 * `data-basemap-mode` — clients réseau mockés, aucun WebGL/API) :
 *   (1) DÉFAUT sans localStorage → mode résolu 'plan' ;
 *   (2) localStorage 'satellite' + host PERMIS → mode résolu 'satellite' ;
 *   (3) GATING : ContentSwitcher rendu SSI le satellite est permis sur ce host
 *       (préprod/localhost) ; ABSENT sinon (prod plan-only) ;
 *   (4) setBasemap : un clic sur « Satellite » PERSISTE (localStorage) et change
 *       le mode transmis au socle (→ ré-init côté socle, testée unitairement) ;
 *   (5) PROD-HIDDEN (anti « satellite dangling ») : host NON-permis + localStorage
 *       'satellite' → mode COERCÉ 'plan' ET aucun switcher (retour plan possible).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/svelte";
import { tick } from "svelte";

// ── Socle carto stubé (maplibre indisponible en jsdom) ────────────────────────
vi.mock("$lib/components/maps/GeoCityMapBase.svelte", async () => {
  const stub = await import("./test-stubs/GeoCityMapBaseStub.svelte");
  return { default: stub.default };
});

// ── Allowlist satellite MOCKÉE (pilotable par test) ───────────────────────────
vi.mock("$lib/maps/geo-sat-basemap.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("$lib/maps/geo-sat-basemap.js")>();
  return { ...actual, isSatelliteBasemapEnabled: vi.fn(() => true) };
});

// ── Clients réseau mockés (aucun fetch réel) ──────────────────────────────────
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

import SignauxMapView from "./SignauxMapView.svelte";
import { isSatelliteBasemapEnabled } from "$lib/maps/geo-sat-basemap.js";

const BASEMAP_LS_KEY = "signaux-basemap-mode";

function basemapMode(): string | null {
  const stub = document.querySelector("[data-testid='stub-map']");
  return stub?.getAttribute("data-basemap-mode") ?? null;
}

beforeEach(() => {
  vi.mocked(isSatelliteBasemapEnabled).mockReturnValue(true);
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

describe("SignauxMapView — fond de carte (2-modes)", () => {
  it("(1) DÉFAUT sans localStorage → mode 'plan'", async () => {
    render(SignauxMapView);
    await tick();
    expect(basemapMode()).toBe("plan");
  });

  it("(2) localStorage 'satellite' + host permis → mode 'satellite'", async () => {
    localStorage.setItem(BASEMAP_LS_KEY, "satellite");
    render(SignauxMapView);
    await tick();
    expect(basemapMode()).toBe("satellite");
  });

  it("(3) GATING : ContentSwitcher rendu si satellite permis", async () => {
    vi.mocked(isSatelliteBasemapEnabled).mockReturnValue(true);
    render(SignauxMapView);
    await tick();
    expect(document.querySelector("[data-testid='basemap-switcher']")).not.toBeNull();
  });

  it("(3) GATING : ContentSwitcher ABSENT si satellite non permis (prod plan-only)", async () => {
    vi.mocked(isSatelliteBasemapEnabled).mockReturnValue(false);
    render(SignauxMapView);
    await tick();
    expect(document.querySelector("[data-testid='basemap-switcher']")).toBeNull();
  });

  it("(4) setBasemap : clic « Satellite » persiste en localStorage et change le mode", async () => {
    vi.mocked(isSatelliteBasemapEnabled).mockReturnValue(true);
    render(SignauxMapView);
    await tick();
    expect(basemapMode()).toBe("plan");

    const switcher = document.querySelector(
      "[data-testid='basemap-switcher']",
    ) as HTMLElement;
    const satBtn = within(switcher).getByRole("tab", { name: "Satellite" });
    await fireEvent.click(satBtn);
    await tick();

    expect(localStorage.getItem(BASEMAP_LS_KEY)).toBe("satellite");
    await waitFor(() => expect(basemapMode()).toBe("satellite"));
  });

  it("(5) PROD-HIDDEN : host non-permis + localStorage 'satellite' → coercion 'plan' + aucun switcher", async () => {
    vi.mocked(isSatelliteBasemapEnabled).mockReturnValue(false);
    localStorage.setItem(BASEMAP_LS_KEY, "satellite");
    render(SignauxMapView);
    await tick();

    // Mode COERCÉ plan (pas de satellite « dangling »)…
    expect(basemapMode()).toBe("plan");
    // …et aucun switcher (sinon l'utilisateur resterait bloqué en satellite).
    expect(document.querySelector("[data-testid='basemap-switcher']")).toBeNull();
  });
});
