/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Real component, fake MapLibre and timers: readiness requires a loaded style,
 * but must not wait for raster tiles or a missing map `load` event. The double
 * rejects premature source/layer creation just like MapLibre. Finalization must
 * remain idempotent and stop if the component unmounts during its asset fetch.
 */
import { cleanup, render } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";

// ── Fake MapLibre : enregistre les handlers, permet de les fire à la demande ───
const mapMocks = vi.hoisted(() => {
  const instances: FakeMap[] = [];
  class FakeMap {
    handlers = new Map<string, Array<(e?: any) => void>>();
    styleReady = true;
    tilesReady = true;
    isStyleLoaded = vi.fn(() => this.styleReady && this.tilesReady);
    addSource = vi.fn(() => this.checkStyle());
    addLayer = vi.fn(() => this.checkStyle());
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
    getCenter = vi.fn(() => ({ lng: -73.5, lat: 45.7 }));
    getZoom = vi.fn(() => 7);
    getBearing = vi.fn(() => 0);
    getPitch = vi.fn(() => 0);
    flyTo = vi.fn();
    easeTo = vi.fn();
    fitBounds = vi.fn();
    constructor(_options: unknown) {
      instances.push(this);
    }
    checkStyle(): void {
      if (!this.styleReady) throw new Error("Style is not done loading.");
    }
    // Surcharge maplibre : on(type, handler) OU on(type, layer, handler).
    on(type: string, a: unknown, b?: unknown): void {
      const handler = (typeof a === "function" ? a : b) as (e?: any) => void;
      // Le repli est indexé sur le SEUL type d'event (« load ») — les handlers
      // portés par une couche (ex. « click »+« cities-fill ») ne nous intéressent
      // pas ici ; on les range sous une clé composite pour ne pas les confondre.
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

// Fond satellite FORCÉ OFF : en jsdom `hostname === "localhost"` est allowlisté
// (le vrai sélecteur activerait le satellite → import de @sentropic/geo-map-engine).
vi.mock("$lib/maps/geo-sat-basemap.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/maps/geo-sat-basemap.js")>();
  return { ...actual, isSatelliteBasemapEnabled: () => false };
});

import GeoCityMapBase from "./GeoCityMapBase.svelte";

// Expression `fill-color` minimale (le socle l'exige) — valeur inerte pour le test.
const FILL_COLOR = ["get", "score"] as unknown as ExpressionSpecification;

// Flush des microtâches (import dynamique maplibre + onMount + effets Svelte) :
// les timers sont factices, mais les promesses/effets restent sur la vraie
// file de microtâches. Vitest 5 resolves a mocked dynamic import over more
// microtask turns than Vitest 3 (12 no longer suffice), hence the margin.
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 100; i += 1) await Promise.resolve();
  await tick();
}

function overlayText(container: HTMLElement): boolean {
  return /Chargement de la carte/.test(container.textContent ?? "");
}

function citiesSourceCalls(map: { addSource: ReturnType<typeof vi.fn> }): number {
  return map.addSource.mock.calls.filter(
    (args) => args[0] === "cities-polygons",
  ).length;
}

beforeEach(() => {
  mapMocks.instances.length = 0;
  vi.useFakeTimers();
  // `fetch` du GeoJSON municipal : rejet → try/catch interne du composant.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("no network (test)"))),
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GeoCityMapBase — résilience mapReady (repli si `load` ne fire pas)", () => {
  it("should wait for a delayed style after the fallback and finalize once without map load", async () => {
    const onReady = vi.fn();
    const { container } = render(GeoCityMapBase, {
      props: { fillColorExpression: FILL_COLOR, onReady },
    });
    await flushMicrotasks();
    const map = mapMocks.instances[0];
    map.styleReady = false;
    map.tilesReady = false;

    await vi.advanceTimersByTimeAsync(6000);
    await flushMicrotasks();
    expect(overlayText(container)).toBe(true);
    expect(map.addSource).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();

    map.styleReady = true;
    map.fire("style.load");
    await flushMicrotasks();
    expect(overlayText(container)).toBe(false);
    expect(citiesSourceCalls(map)).toBe(1);
    expect(onReady).toHaveBeenCalledTimes(1);
    map.fire("load");
    map.fire("style.load");
    await flushMicrotasks();
    expect(citiesSourceCalls(map)).toBe(1);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("should finalize on style load while raster tiles are still pending", async () => {
    const onReady = vi.fn();
    const { container } = render(GeoCityMapBase, {
      props: { fillColorExpression: FILL_COLOR, onReady },
    });
    await flushMicrotasks();
    const map = mapMocks.instances[0];
    map.tilesReady = false;
    map.fire("style.load");
    await flushMicrotasks();
    expect(map.isStyleLoaded()).toBe(false);
    expect(overlayText(container)).toBe(false);
    expect(onReady).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6000);
    expect(citiesSourceCalls(map)).toBe(1);
  });

  it("should ignore boundary data received after unmount during finalization", async () => {
    let finishFetch!: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => {
      finishFetch = resolve as typeof finishFetch;
    }));
    const onReady = vi.fn();
    const { unmount } = render(GeoCityMapBase, {
      props: { fillColorExpression: FILL_COLOR, onReady },
    });
    await flushMicrotasks();
    const map = mapMocks.instances[0];
    map.fire("load");
    await flushMicrotasks();
    unmount();
    finishFetch({ ok: true, json: async () => ({ type: "FeatureCollection", features: [] }) });
    await flushMicrotasks();
    expect(map.remove).toHaveBeenCalledTimes(1);
    expect(map.addSource).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
  });

  it("REPLI : `load` jamais émis → après MAP_READY_FALLBACK_MS l'overlay « Chargement… » disparaît", async () => {
    const onReady = vi.fn();
    const { container } = render(GeoCityMapBase, {
      props: { fillColorExpression: FILL_COLOR, onReady },
    });
    // La carte s'initialise (maplibre importé, timeout de repli armé) mais
    // `'load'` n'est JAMAIS déclenché — overlay encore présent.
    await flushMicrotasks();
    expect(mapMocks.instances).toHaveLength(1);
    expect(overlayText(container)).toBe(true);
    expect(onReady).not.toHaveBeenCalled();

    // Avance des timers factices jusqu'au repli (6 s) → finalisation forcée.
    await vi.advanceTimersByTimeAsync(6000);
    await flushMicrotasks();

    expect(overlayText(container)).toBe(false); // overlay levé
    expect(citiesSourceCalls(mapMocks.instances[0])).toBe(1); // couches posées
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("NOMINAL : `load` fire → finalisation UNE fois, repli annulé (pas de seconde pose)", async () => {
    const onReady = vi.fn();
    const { container } = render(GeoCityMapBase, {
      props: { fillColorExpression: FILL_COLOR, onReady },
    });
    await flushMicrotasks();
    const map = mapMocks.instances[0];
    expect(overlayText(container)).toBe(true); // avant load

    map.fire("load");
    await flushMicrotasks();

    expect(overlayText(container)).toBe(false); // load a levé l'overlay
    expect(citiesSourceCalls(map)).toBe(1);
    expect(onReady).toHaveBeenCalledTimes(1);

    // Le repli a été annulé à la finalisation : avancer les timers ne relance rien.
    await vi.advanceTimersByTimeAsync(6000);
    await flushMicrotasks();
    expect(citiesSourceCalls(map)).toBe(1); // toujours une seule pose
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("IDEMPOTENCE : `load` fire deux fois → un seul `addSource(\"cities-polygons\")`", async () => {
    render(GeoCityMapBase, { props: { fillColorExpression: FILL_COLOR } });
    await flushMicrotasks();
    const map = mapMocks.instances[0];

    map.fire("load");
    await flushMicrotasks();
    map.fire("load");
    await flushMicrotasks();

    // Le garde `mapSetupStarted` interdit la seconde pose (sinon « source already
    // exists » côté MapLibre réel).
    expect(citiesSourceCalls(map)).toBe(1);
  });
});
