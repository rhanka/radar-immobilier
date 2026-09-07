/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * §5 2-modes — PILOTAGE du fond de carte par `basemapMode` (ADR-0033).
 *
 * Le socle `GeoCityMapBase` ne construit le fond SATELLITE que si le mode courant
 * vaut `'satellite'` ; sinon (défaut `'plan'`) → fond OSM, aucun appel à l'adapter
 * satellite. Un changement de `basemapMode` APRÈS montage RÉ-INITIALISE la carte
 * (contrainte MapLibre : `transformRequest` non modifiable au runtime) en
 * préservant le viewport courant. Cas (c) : satellite demandé mais mint
 * indisponible → repli OSM + `onBasemapFallback` (le mode NE retombe PAS sur plan).
 *
 * Pur : maplibre-gl MOCKÉ (jamais monté en jsdom), l'adapter geo-map-engine et le
 * sélecteur d'allowlist satellite MOCKÉS, `fetch` stubé.
 */
import { cleanup, render } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";

// ── Fake MapLibre : capture les OPTIONS du constructeur + permet de fire `load` ──
const mapMocks = vi.hoisted(() => {
  const instances: FakeMap[] = [];
  class FakeMap {
    options: any;
    handlers = new Map<string, Array<(e?: any) => void>>();
    addSource = vi.fn();
    addLayer = vi.fn();
    setPaintProperty = vi.fn();
    setLayoutProperty = vi.fn();
    moveLayer = vi.fn();
    setFeatureState = vi.fn();
    removeLayer = vi.fn();
    removeSource = vi.fn();
    addControl = vi.fn();
    remove = vi.fn();
    getLayer = vi.fn(() => undefined);
    getSource = vi.fn(() => undefined);
    getCanvas = vi.fn(() => ({ style: {} as Record<string, string> }));
    getContainer = vi.fn(() => document.createElement("div"));
    getCenter = vi.fn(() => ({ lng: -71.2, lat: 46.8 }));
    getZoom = vi.fn(() => 11);
    getBearing = vi.fn(() => 0);
    getPitch = vi.fn(() => 0);
    flyTo = vi.fn();
    easeTo = vi.fn();
    fitBounds = vi.fn();
    constructor(options: unknown) {
      this.options = options;
      instances.push(this);
    }
    on(type: string, a: unknown, b?: unknown): void {
      const handler = (typeof a === "function" ? a : b) as (e?: any) => void;
      const key = typeof a === "function" ? type : `${type}:${String(a)}`;
      const list = this.handlers.get(key) ?? [];
      list.push(handler);
      this.handlers.set(key, list);
    }
    fire(type: string, e?: unknown): void {
      for (const handler of this.handlers.get(type) ?? []) handler(e);
    }
  }
  return { instances, FakeMap };
});

vi.mock("maplibre-gl", () => ({ default: { Map: mapMocks.FakeMap } }));

// ── Adapter satellite geo-map-engine MOCKÉ (zéro-copie du vrai contrat) ────────
const engineMocks = vi.hoisted(() => {
  const createGoogle2dBasemapAdapter = vi.fn(async () => ({
    basemap: { source: {} },
    resolveRasterSource: () => ({
      tileUrlTemplateBase: "https://sat.example/{z}/{x}/{y}",
      tileSize: { width: 256 },
      attributionResolver: null,
    }),
    options: { transformRequest: (url: string) => ({ url }) },
  }));
  return { createGoogle2dBasemapAdapter };
});

vi.mock("@sentropic/geo-map-engine", () => ({
  createGoogle2dBasemapAdapter: engineMocks.createGoogle2dBasemapAdapter,
}));

// ── Satellite PERMIS sur ce host (on teste le pilotage par MODE, pas l'allowlist) ─
vi.mock("$lib/maps/geo-sat-basemap.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("$lib/maps/geo-sat-basemap.js")>();
  return { ...actual, isSatelliteBasemapEnabled: () => true };
});

import GeoCityMapBase from "./GeoCityMapBase.svelte";

const FILL_COLOR = ["get", "score"] as unknown as ExpressionSpecification;

// Draine micro- ET macro-tâches : le mode satellite enchaîne DEUX imports
// dynamiques (maplibre-gl puis l'adapter geo-map-engine) dont la résolution peut
// glisser sur la file macrotâche → un simple flush de microtâches ne suffit pas.
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 24; i += 1) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    await tick();
  }
}

beforeEach(() => {
  mapMocks.instances.length = 0;
  engineMocks.createGoogle2dBasemapAdapter.mockClear();
  engineMocks.createGoogle2dBasemapAdapter.mockResolvedValue({
    basemap: { source: {} },
    resolveRasterSource: () => ({
      tileUrlTemplateBase: "https://sat.example/{z}/{x}/{y}",
      tileSize: { width: 256 },
      attributionResolver: null,
    }),
    options: { transformRequest: (url: string) => ({ url }) },
  } as any);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("no network (test)"))),
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GeoCityMapBase — pilotage du fond par basemapMode", () => {
  it("DÉFAUT 'plan' : aucun fond satellite construit (fond OSM, pas de transformRequest)", async () => {
    render(GeoCityMapBase, { props: { fillColorExpression: FILL_COLOR } });
    await flushMicrotasks();

    expect(mapMocks.instances).toHaveLength(1);
    // L'adapter satellite n'est même pas sollicité en mode plan.
    expect(engineMocks.createGoogle2dBasemapAdapter).not.toHaveBeenCalled();
    const opts = mapMocks.instances[0].options;
    // Pas d'injecteur de tuiles satellite, pas de source sat-2d → fond OSM.
    expect(opts.transformRequest).toBeUndefined();
    expect(opts.style.sources["sat-2d"]).toBeUndefined();
    expect(opts.style.layers.some((l: any) => l.id === "sat-2d-background")).toBe(
      false,
    );
  });

  it("MODE 'satellite' : fond satellite construit (adapter appelé, transformRequest + source sat-2d)", async () => {
    render(GeoCityMapBase, {
      props: { fillColorExpression: FILL_COLOR, basemapMode: "satellite" },
    });
    await flushMicrotasks();

    expect(mapMocks.instances).toHaveLength(1);
    expect(engineMocks.createGoogle2dBasemapAdapter).toHaveBeenCalledTimes(1);
    const opts = mapMocks.instances[0].options;
    expect(typeof opts.transformRequest).toBe("function");
    expect(opts.style.sources["sat-2d"]).toBeDefined();
    expect(opts.style.layers.some((l: any) => l.id === "sat-2d-background")).toBe(
      true,
    );
  });

  it("CAS (c) : satellite demandé mais mint indisponible → repli OSM + onBasemapFallback (mode NON retombé)", async () => {
    engineMocks.createGoogle2dBasemapAdapter.mockRejectedValueOnce(
      new Error("mint 503"),
    );
    const onBasemapFallback = vi.fn();
    render(GeoCityMapBase, {
      props: {
        fillColorExpression: FILL_COLOR,
        basemapMode: "satellite",
        onBasemapFallback,
      },
    });
    await flushMicrotasks();

    expect(mapMocks.instances).toHaveLength(1);
    // Repli OSM : pas de transformRequest injecté, la notice de repli est poussée.
    const opts = mapMocks.instances[0].options;
    expect(opts.transformRequest).toBeUndefined();
    expect(opts.style.sources["sat-2d"]).toBeUndefined();
    expect(onBasemapFallback).toHaveBeenCalledTimes(1);
  });

  it("RÉ-INIT : changer basemapMode après montage détruit la carte et en reconstruit une (viewport préservé)", async () => {
    const { rerender } = render(GeoCityMapBase, {
      props: { fillColorExpression: FILL_COLOR, basemapMode: "plan" },
    });
    await flushMicrotasks();
    // Carte prête en plan.
    mapMocks.instances[0].fire("load");
    await flushMicrotasks();
    expect(mapMocks.instances).toHaveLength(1);
    const firstMap = mapMocks.instances[0];

    // Switch → satellite : la prop change → ré-init.
    await rerender({ fillColorExpression: FILL_COLOR, basemapMode: "satellite" });
    await flushMicrotasks();

    // Ancienne carte détruite, nouvelle carte créée en satellite.
    expect(firstMap.remove).toHaveBeenCalledTimes(1);
    expect(mapMocks.instances).toHaveLength(2);
    const secondMap = mapMocks.instances[1];
    expect(typeof secondMap.options.transformRequest).toBe("function");
    // Viewport PRÉSERVÉ : la carte neuve repart du centre/zoom courant (getCenter
    // = [-71.2, 46.8], getZoom = 11 de la 1re carte), PAS du cadrage Québec initial.
    expect(secondMap.options.center).toEqual([-71.2, 46.8]);
    expect(secondMap.options.zoom).toBe(11);
  });
});
