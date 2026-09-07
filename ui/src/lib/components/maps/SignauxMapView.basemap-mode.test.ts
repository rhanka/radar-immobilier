/**
 * SignauxMapView — §5 2-modes : FOND de carte (PLAN défaut / SATELLITE switchable).
 *
 * §2 point 1/2 : le groupe Plan/Satellite a MIGRÉ hors de la vue (plus de
 * ContentSwitcher haut-droit) vers les contrôles bas-droit du SOCLE. Ici le socle
 * est stubé (maplibre indisponible en jsdom) ; le stub reflète le mode reçu en
 * `data-basemap-mode`, le gating en `data-show-basemap-control`, et expose une
 * DOUBLURE du groupe (boutons « Afficher le plan/satellite ») qui appelle
 * `onBasemapModeChange` → permet de tester la PERSISTANCE de `setBasemap`. L'a11y
 * des boutons NATIFS réels est couverte dans `GeoCityMapBase.basemap-mode.test.ts`.
 *
 * Contrat vérifié (clients réseau mockés, aucun WebGL/API) :
 *   (1) DÉFAUT sans localStorage → mode résolu 'plan' ;
 *   (1b) clé ABSENTE ou valeur INCONNUE → 'plan' (Point 1, jamais de faux satellite) ;
 *   (2) localStorage 'satellite' + host PERMIS → 'satellite' (préférence restaurée) ;
 *   (3) HOST GATING : groupe Fond de carte passé au socle SSI satellite permis ;
 *   (4) PERSISTENCE : clic « Satellite » (doublure socle) → localStorage + mode ;
 *   (5) PROD-HIDDEN : host NON-permis + localStorage 'satellite' → COERCÉ 'plan' ;
 *   (6) ABSENCE du switch haut-droit (l'ancien ContentSwitcher n'existe plus).
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

function showBasemapControl(): string | null {
  const stub = document.querySelector("[data-testid='stub-map']");
  return stub?.getAttribute("data-show-basemap-control") ?? null;
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

  it("(1b) clé ABSENTE / valeur INCONNUE → 'plan' (jamais de satellite fabriqué)", async () => {
    localStorage.setItem(BASEMAP_LS_KEY, "bogus-value");
    render(SignauxMapView);
    await tick();
    // Une valeur persistée non reconnue retombe sur Plan (Point 1).
    expect(basemapMode()).toBe("plan");
  });

  it("(2) localStorage 'satellite' + host permis → 'satellite' (préférence restaurée)", async () => {
    localStorage.setItem(BASEMAP_LS_KEY, "satellite");
    render(SignauxMapView);
    await tick();
    expect(basemapMode()).toBe("satellite");
  });

  it("(3) HOST GATING : groupe Fond de carte transmis au socle SSI satellite permis", async () => {
    vi.mocked(isSatelliteBasemapEnabled).mockReturnValue(true);
    render(SignauxMapView);
    await tick();
    // showBasemapControl={satelliteHostAllowed} → true, groupe rendu côté socle.
    expect(showBasemapControl()).toBe("true");
    expect(document.querySelector("[data-testid='basemap-control']")).not.toBeNull();
  });

  it("(3) HOST GATING : aucun groupe Fond de carte si satellite NON permis (prod plan-only)", async () => {
    vi.mocked(isSatelliteBasemapEnabled).mockReturnValue(false);
    render(SignauxMapView);
    await tick();
    expect(showBasemapControl()).toBe("false");
    expect(document.querySelector("[data-testid='basemap-control']")).toBeNull();
  });

  it("(4) PERSISTENCE : clic « Satellite » persiste en localStorage et change le mode transmis", async () => {
    vi.mocked(isSatelliteBasemapEnabled).mockReturnValue(true);
    render(SignauxMapView);
    await tick();
    expect(basemapMode()).toBe("plan");

    const group = document.querySelector(
      "[data-testid='basemap-control']",
    ) as HTMLElement;
    const satBtn = within(group).getByRole("button", { name: "Afficher le satellite" });
    await fireEvent.click(satBtn);
    await tick();

    // setBasemap (writer unique) persiste ET change la prop → ré-init socle.
    expect(localStorage.getItem(BASEMAP_LS_KEY)).toBe("satellite");
    await waitFor(() => expect(basemapMode()).toBe("satellite"));
  });

  it("(5) PROD-HIDDEN : host non-permis + localStorage 'satellite' → coercion 'plan' + aucun groupe", async () => {
    vi.mocked(isSatelliteBasemapEnabled).mockReturnValue(false);
    localStorage.setItem(BASEMAP_LS_KEY, "satellite");
    render(SignauxMapView);
    await tick();

    // Mode COERCÉ plan (pas de satellite « dangling »)…
    expect(basemapMode()).toBe("plan");
    // …et aucun groupe de fond (sinon l'utilisateur resterait bloqué en satellite).
    expect(document.querySelector("[data-testid='basemap-control']")).toBeNull();
  });

  it("(6) ABSENCE du switch haut-droit : l'ancien ContentSwitcher n'existe plus dans la vue", async () => {
    vi.mocked(isSatelliteBasemapEnabled).mockReturnValue(true);
    render(SignauxMapView);
    await tick();
    // Le sélecteur de fond haut-droit (ancien ContentSwitcher) a migré dans le socle.
    expect(document.querySelector("[data-testid='basemap-switcher']")).toBeNull();
  });
});
