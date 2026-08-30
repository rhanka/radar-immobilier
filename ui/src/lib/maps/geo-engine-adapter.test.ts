import { describe, it, expect, vi } from "vitest";
// NB : on n'importe QUE des TYPES de `@sentropic/geo-map-engine` (effacés à la compilation) —
// importer un runtime du package chargerait maplibre-gl (indisponible en jsdom). Le binding des
// TYPES GELÉS est prouvé par le typecheck ; le mock (ci-dessous) tient lieu de moteur. Le câblage
// runtime du VRAI moteur (+ garde de CONTRACT_VERSION) relève du Lot 2 (vue, maplibre présent).
import type { GeoViewport, BasemapSpec, GeoLayerSpec } from "@sentropic/geo-map-engine";
import { createMockGeoMap } from "./geo-engine-mock.js";
import { mountGeoEngine, resolveDsTokens } from "./geo-engine-adapter.js";

const basemap: BasemapSpec = { kind: "blank", background: "surface-muted" };
const viewport: GeoViewport = { center: [-73.5, 45.4], zoom: 11, bearing: 0, pitch: 0 };
const layers: readonly GeoLayerSpec[] = [];

const HANDLE_METHODS = [
  "setLayers",
  "setBasemap",
  "setViewport",
  "setRenderer",
  "setTokens",
  "flyTo",
  "fitBounds",
  "recenterKeepZoom",
  "resetToInitialView",
  "syncLayers",
  "queryRenderedFeatures",
  "getFeatureBoundary",
  "destroy",
] as const;

describe("geo-engine-adapter — binding contrat gelé v1 + mock", () => {
  it("le mock est contract-conformant : mount → handle avec TOUTES les méthodes gelées", () => {
    const { mount } = createMockGeoMap();
    const host = document.createElement("div");
    const handle = mount(host, { basemap, layers, viewport, renderer: "2d", tokens: {} });
    for (const method of HANDLE_METHODS) {
      expect(typeof (handle as unknown as Record<string, unknown>)[method]).toBe("function");
    }
    // Lectures gelées : formes contractuelles (liste vide / null), jamais une valeur inventée.
    expect(handle.queryRenderedFeatures()).toEqual([]);
    expect(handle.getFeatureBoundary("zones", 1)).toBeNull();
  });

  it("mountGeoEngine monte via le mount injecté, renderer '2d' par défaut (3D pas encore land)", () => {
    const { mount, state } = createMockGeoMap();
    const host = document.createElement("div");
    const onReady = vi.fn();
    mountGeoEngine(mount, host, {
      basemap,
      layers,
      viewport,
      tokens: { category1: "#123456" },
      onReady,
    });
    expect(state.mounted).toBe(true);
    expect(state.host).toBe(host);
    expect(state.renderer).toBe("2d");
    expect(state.basemap).toEqual(basemap);
    expect(state.viewport).toEqual(viewport);
    expect(state.tokens).toEqual({ category1: "#123456" });
    expect(onReady).toHaveBeenCalledOnce();
  });

  it("le handle délègue les commandes déclaratives ET impératives au moteur (host stable)", () => {
    const { mount, state } = createMockGeoMap();
    const host = document.createElement("div");
    const handle = mountGeoEngine(mount, host, { basemap, layers, viewport, tokens: {} });
    handle.setViewport({ center: [-71, 46], zoom: 9, bearing: 0, pitch: 0 });
    expect(state.viewport?.zoom).toBe(9);
    handle.flyTo({ zoom: 14 });
    expect(state.viewport?.zoom).toBe(14);
    handle.destroy();
    expect(state.mounted).toBe(false);
    expect(state.calls).toEqual([
      "mount",
      "setViewport",
      "flyTo",
      "destroy",
    ]);
  });

  it("resolveDsTokens mappe les rôles vers les `--st-<role>` résolus (DOM → TokenMap), omet l'absent", () => {
    const host = document.createElement("div");
    const spy = vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (prop: string) => (prop === "--st-category1" ? "#abcdef" : ""),
    } as unknown as CSSStyleDeclaration);
    const tokens = resolveDsTokens(host, ["category1", "absent"]);
    expect(tokens.category1).toBe("#abcdef");
    expect(tokens.absent).toBeUndefined();
    spy.mockRestore();
  });
});
