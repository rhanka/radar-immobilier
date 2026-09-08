/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * §5 2-modes — PILOTAGE du fond de carte par `basemapMode` + contrôle bas-droit.
 *
 * Le socle `GeoCityMapBase` ne construit le fond SATELLITE que si le mode courant
 * vaut `'satellite'` ; sinon (défaut `'plan'`) → fond OSM, aucun appel à l'adapter
 * satellite (verrou du Point 1 : clé absente/inconnue ⇒ Plan ET 0 appel adapter,
 * résolu côté VUE dans SignauxMapView.basemap-mode.test.ts, résolu côté SOCLE ici).
 * Un changement de `basemapMode` APRÈS montage RÉ-INITIALISE la carte (contrainte
 * MapLibre : `transformRequest` non modifiable au runtime) en préservant le
 * viewport. Cas (c) : satellite demandé mais indisponible (mint / attribution
 * absente) → repli OSM + `onBasemapFallback` (le mode NE retombe PAS sur plan).
 *
 * Couverture ajoutée (§6) :
 *  - PAINT PAR MODE : `cities-fill.fill-opacity` = 0 en satellite, expression plan
 *    sinon ; `cities-outline` reprend l'expression couleur en satellite ;
 *  - §5.3 : refus du raster sans attribution résolvable → repli OSM ;
 *  - CONTRÔLE (§4 R2) : UN seul trigger « Fond de carte » (menu DS Layers) rendu
 *    SSI `showBasemapControl`, ouvrant deux options radio Plan/Satellite ;
 *    sélection → `onBasemapModeChange` ;
 *  - EMPHASE CPTAQ (§7 R2) : `setCptaqLegendEmphasis` accentue `cptaq-fill` seul,
 *    hover > repos, retour au repos (0 en satellite) à la sortie.
 *
 * Pur : maplibre-gl MOCKÉ (jamais monté en jsdom), l'adapter geo-map-engine et le
 * sélecteur d'allowlist satellite MOCKÉS, `fetch` stubé.
 */
import { cleanup, render, screen, fireEvent } from "@testing-library/svelte";
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
// §5.3 — l'attribution DOIT être résolvable, sinon le socle REFUSE le raster et
// replie sur OSM : le mock fournit donc un `attributionResolver` non-null.
const engineMocks = vi.hoisted(() => {
  const makeResolved = (attributionResolver: unknown) => ({
    basemap: { source: {} },
    resolveRasterSource: () => ({
      tileUrlTemplateBase: "https://sat.example/{z}/{x}/{y}",
      tileSize: { width: 256 },
      attributionResolver,
    }),
    options: { transformRequest: (url: string) => ({ url }) },
  });
  const createGoogle2dBasemapAdapter = vi.fn(async () =>
    makeResolved(async () => "Imagerie © Fournisseur"),
  );
  return { createGoogle2dBasemapAdapter, makeResolved };
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
const FILL_OPACITY = ["case", ["get", "hit"], 0.75, 0.4] as unknown as ExpressionSpecification;

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

/** Retrouve la spec de couche posée par `addLayer` pour un id donné. */
function layerPaint(map: InstanceType<typeof mapMocks.FakeMap>, id: string): any {
  const call = map.addLayer.mock.calls.find((c) => (c[0] as any)?.id === id);
  return (call?.[0] as any)?.paint;
}

/** Dernière valeur posée par `setPaintProperty(id, prop, value)` (ou undefined). */
function lastPaint(
  map: InstanceType<typeof mapMocks.FakeMap>,
  id: string,
  prop: string,
): any {
  const calls = map.setPaintProperty.mock.calls.filter(
    (c) => c[0] === id && c[1] === prop,
  );
  return calls.length ? calls[calls.length - 1][2] : undefined;
}

beforeEach(() => {
  mapMocks.instances.length = 0;
  engineMocks.createGoogle2dBasemapAdapter.mockClear();
  engineMocks.createGoogle2dBasemapAdapter.mockResolvedValue(
    engineMocks.makeResolved(async () => "Imagerie © Fournisseur") as any,
  );
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
  it("DÉFAUT 'plan' : aucun fond satellite construit (fond OSM, pas de transformRequest) ET 0 appel adapter", async () => {
    render(GeoCityMapBase, { props: { fillColorExpression: FILL_COLOR } });
    await flushMicrotasks();

    expect(mapMocks.instances).toHaveLength(1);
    // Point 1 (socle) — l'adapter satellite n'est même pas sollicité en mode plan.
    expect(engineMocks.createGoogle2dBasemapAdapter).not.toHaveBeenCalled();
    const opts = mapMocks.instances[0].options;
    expect(opts.transformRequest).toBeUndefined();
    expect(opts.style.sources["sat-2d"]).toBeUndefined();
    expect(opts.style.layers.some((l: any) => l.id === "sat-2d-background")).toBe(
      false,
    );
  });

  it("§5 R3 P1 — attributionControl:false : le contrôle d'attribution PAR DÉFAUT de MapLibre est EXCLU du constructeur (plan ET satellite)", async () => {
    // Non-régression P1 : sans cette option, MapLibre injecte au coin bas-droit
    // une bulle compacte « © OpenStreetMap contributors | MapLibre » + ▼ (reproduit
    // en navigateur) LÀ où s'ouvre le menu Layers → l'owner la voyait au lieu du
    // menu. On asserte l'option EFFECTIVEMENT passée au constructeur (pas la source).
    render(GeoCityMapBase, { props: { fillColorExpression: FILL_COLOR } });
    await flushMicrotasks();
    expect(mapMocks.instances).toHaveLength(1);
    expect(mapMocks.instances[0].options.attributionControl).toBe(false);

    // Idem en satellite : l'exclusion vaut aussi (l'attribution satellite reste,
    // elle, rendue par l'overlay léger contextuel alimenté par `wireSatelliteAttribution`).
    mapMocks.instances.length = 0;
    cleanup();
    render(GeoCityMapBase, {
      props: { fillColorExpression: FILL_COLOR, basemapMode: "satellite" },
    });
    await flushMicrotasks();
    expect(mapMocks.instances[0].options.attributionControl).toBe(false);
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
    // §5 R3 — l'attribution PROVIDER dynamique n'est PLUS un contrôle MapLibre
    // séparé : elle alimente l'overlay léger CONTEXTUEL (data-attribution-layer=
    // satellite). Le resolver du mock renvoie « Imagerie © Fournisseur ».
    mapMocks.instances[0].fire("load");
    await flushMicrotasks();
    await tick();
    const attribution = screen.getByTestId("map-attribution");
    expect(attribution.getAttribute("data-attribution-layer")).toBe("satellite");
    expect(attribution.textContent).toContain("Imagerie © Fournisseur");
    // Aucun contrôle MapLibre ajouté (plus d'attribution via addControl).
    expect(mapMocks.instances[0].addControl).not.toHaveBeenCalled();
  });

  it("§5 R3 — MODE 'plan' : overlay d'attribution CONTEXTUEL « © OpenStreetMap » (mention légale restaurée, hors-flux)", async () => {
    render(GeoCityMapBase, {
      props: { fillColorExpression: FILL_COLOR, basemapMode: "plan" },
    });
    await flushMicrotasks();
    await tick();
    const attribution = screen.getByTestId("map-attribution");
    // Contextuel OSM en plan, mention légale présente, PAS le texte provider.
    expect(attribution.getAttribute("data-attribution-layer")).toBe("osm");
    // `\s` couvre l'espace insécable (&nbsp;, U+00A0) du séparateur « © OpenStreetMap ».
    expect(attribution.textContent ?? "").toMatch(/©\s?OpenStreetMap/);
    expect(attribution.textContent ?? "").not.toContain("Fournisseur");
    // Lien légal vers la page de copyright OSM.
    const link = attribution.querySelector("a");
    expect(link?.getAttribute("href")).toBe(
      "https://www.openstreetmap.org/copyright",
    );
    // Overlay hors-flux : jamais ajouté comme contrôle MapLibre.
    expect(mapMocks.instances[0].addControl).not.toHaveBeenCalled();
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
    const opts = mapMocks.instances[0].options;
    expect(opts.transformRequest).toBeUndefined();
    expect(opts.style.sources["sat-2d"]).toBeUndefined();
    expect(onBasemapFallback).toHaveBeenCalledTimes(1);
  });

  it("§5.3 — adapter SANS attribution résolvable → repli OSM + onBasemapFallback (jamais de tuiles sans mention légale)", async () => {
    engineMocks.createGoogle2dBasemapAdapter.mockResolvedValueOnce(
      engineMocks.makeResolved(null) as any,
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
    const opts = mapMocks.instances[0].options;
    // Raster refusé : pas d'injecteur de tuiles, pas de source sat-2d → OSM.
    expect(opts.transformRequest).toBeUndefined();
    expect(opts.style.sources["sat-2d"]).toBeUndefined();
    expect(onBasemapFallback).toHaveBeenCalledTimes(1);
  });

  it("RÉ-INIT : changer basemapMode après montage détruit la carte et en reconstruit une (viewport préservé)", async () => {
    const { rerender } = render(GeoCityMapBase, {
      props: { fillColorExpression: FILL_COLOR, basemapMode: "plan" },
    });
    await flushMicrotasks();
    mapMocks.instances[0].fire("load");
    await flushMicrotasks();
    expect(mapMocks.instances).toHaveLength(1);
    const firstMap = mapMocks.instances[0];

    // Switch → satellite : la prop change → ré-init.
    await rerender({ fillColorExpression: FILL_COLOR, basemapMode: "satellite" });
    await flushMicrotasks();

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

describe("GeoCityMapBase — §1/§3 paint par mode (surfaceFillOpacity)", () => {
  it("PLAN : cities-fill.fill-opacity = l'expression métier (aplat rempli)", async () => {
    render(GeoCityMapBase, {
      props: {
        fillColorExpression: FILL_COLOR,
        fillOpacityExpression: FILL_OPACITY,
        basemapMode: "plan",
      },
    });
    await flushMicrotasks();
    mapMocks.instances[0].fire("load");
    await flushMicrotasks();

    const paint = layerPaint(mapMocks.instances[0], "cities-fill");
    expect(paint).toBeDefined();
    // En plan, l'invariant repasse l'expression métier telle quelle.
    expect(paint["fill-opacity"]).toBe(FILL_OPACITY);
    // §3 — pas de `fill-outline-color` redondant sur l'aplat.
    expect(paint["fill-outline-color"]).toBeUndefined();
  });

  it("SATELLITE : cities-fill.fill-opacity = 0 ET cities-outline reprend l'expression couleur", async () => {
    render(GeoCityMapBase, {
      props: {
        fillColorExpression: FILL_COLOR,
        fillOpacityExpression: FILL_OPACITY,
        basemapMode: "satellite",
      },
    });
    await flushMicrotasks();
    mapMocks.instances[0].fire("load");
    await flushMicrotasks();

    const fillPaint = layerPaint(mapMocks.instances[0], "cities-fill");
    expect(fillPaint["fill-opacity"]).toBe(0); // aucun aplat région en satellite
    const outlinePaint = layerPaint(mapMocks.instances[0], "cities-outline");
    // §3 — la MEANING passe au contour : même expression couleur que la légende.
    expect(outlinePaint["line-color"]).toBe(FILL_COLOR);
    expect(outlinePaint["line-opacity"]).toBe(1);
  });
});

describe("GeoCityMapBase — §1/§6 invariant d'opacité sur zones / lots / CPTAQ", () => {
  const EMPTY_FC = { type: "FeatureCollection" as const, features: [] };
  const LAYERS_INPUT = {
    zones: EMPTY_FC,
    lots: EMPTY_FC,
    zoneFillColor: ["get", "kindColor"] as unknown,
    zoneFillOpacity: 0.25 as unknown,
    lotFillColor: ["get", "lotColor"] as unknown,
    lotFillOpacity: 0.4 as unknown,
    lotLineColor: "#2563eb" as unknown,
  };

  async function mountAndReady(basemapMode: "plan" | "satellite"): Promise<{
    map: InstanceType<typeof mapMocks.FakeMap>;
    api: any;
  }> {
    let api: any = null;
    render(GeoCityMapBase, {
      props: {
        fillColorExpression: FILL_COLOR,
        basemapMode,
        onReady: (a: unknown) => {
          api = a;
        },
      },
    });
    await flushMicrotasks();
    mapMocks.instances[0].fire("load");
    await flushMicrotasks();
    return { map: mapMocks.instances[0], api };
  }

  it("SATELLITE : zones, lots ET CPTAQ passent à fill-opacity 0 (aplats transparents)", async () => {
    const { map, api } = await mountAndReady("satellite");
    api.syncGeoLayers(LAYERS_INPUT);
    api.setCptaqData(EMPTY_FC);

    expect(layerPaint(map, "selected-zones-fill")["fill-opacity"]).toBe(0);
    expect(layerPaint(map, "selected-lots-fill")["fill-opacity"]).toBe(0);
    expect(layerPaint(map, "cptaq-fill")["fill-opacity"]).toBe(0);
    // §3/§4 — aucun `fill-outline-color` redondant sur les aplats.
    expect(layerPaint(map, "selected-zones-fill")["fill-outline-color"]).toBeUndefined();
    expect(layerPaint(map, "selected-lots-fill")["fill-outline-color"]).toBeUndefined();
  });

  it("PLAN : zones, lots ET CPTAQ gardent l'opacité métier (aplats remplis)", async () => {
    const { map, api } = await mountAndReady("plan");
    api.syncGeoLayers(LAYERS_INPUT);
    api.setCptaqData(EMPTY_FC);

    // L'invariant repasse l'expression/valeur métier telle quelle en plan.
    expect(layerPaint(map, "selected-zones-fill")["fill-opacity"]).toBe(0.25);
    expect(layerPaint(map, "selected-lots-fill")["fill-opacity"]).toBe(0.4);
    expect(layerPaint(map, "cptaq-fill")["fill-opacity"]).toBe(0.25);
  });

  // §7 R2 — EMPHASE hover/focus de « Agricole (CPTAQ) » : isolée à `cptaq-fill`.
  // Le test asserte hover > repos (PAS un nombre exact — la valeur est un
  // source-gap provisoire à ratifier owner) et le RETOUR au repos à la sortie.
  it("EMPHASE (Plan) : setCptaqLegendEmphasis(true) → fill-opacity > repos ; (false) → repos", async () => {
    const { map, api } = await mountAndReady("plan");
    api.setCptaqData(EMPTY_FC);
    const resting = layerPaint(map, "cptaq-fill")["fill-opacity"];
    expect(resting).toBe(0.25);
    // La couche existe désormais : `getLayer` doit la renvoyer truthy pour que
    // `setPaintProperty` de l'emphase s'applique (le FakeMap renvoie undefined par défaut).
    map.getLayer = vi.fn((id: string) => (id === "cptaq-fill" ? {} : undefined));

    api.setCptaqLegendEmphasis(true);
    expect(lastPaint(map, "cptaq-fill", "fill-opacity")).toBeGreaterThan(resting);

    api.setCptaqLegendEmphasis(false);
    expect(lastPaint(map, "cptaq-fill", "fill-opacity")).toBe(resting);
  });

  it("EMPHASE (Satellite) : repos 0, emphase > 0 (aplat temporaire), sortie retour 0", async () => {
    const { map, api } = await mountAndReady("satellite");
    api.setCptaqData(EMPTY_FC);
    expect(layerPaint(map, "cptaq-fill")["fill-opacity"]).toBe(0);
    map.getLayer = vi.fn((id: string) => (id === "cptaq-fill" ? {} : undefined));

    api.setCptaqLegendEmphasis(true);
    // Exception transitoire demandée : un aplat rend même en satellite.
    expect(lastPaint(map, "cptaq-fill", "fill-opacity")).toBeGreaterThan(0);

    api.setCptaqLegendEmphasis(false);
    // Retour IMMÉDIAT à 0 en satellite (invariant #646 rétabli à la sortie).
    expect(lastPaint(map, "cptaq-fill", "fill-opacity")).toBe(0);
  });
});

describe("GeoCityMapBase — contrôle « Fond de carte » (§4 R2 : menu Layers)", () => {
  it("showBasemapControl=true : UN seul trigger (aria-haspopup=menu) ouvre un menu à 2 options radio ; sélection → onBasemapModeChange", async () => {
    const onBasemapModeChange = vi.fn();
    render(GeoCityMapBase, {
      props: {
        fillColorExpression: FILL_COLOR,
        basemapMode: "plan",
        showBasemapControl: true,
        onBasemapModeChange,
      },
    });
    await flushMicrotasks();

    // UN seul déclencheur, pas deux boutons pressés (les deux boutons #646 ont disparu).
    const trigger = screen.getByRole("button", { name: /Fond de carte/ });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("basemap-btn-plan")).toBeNull();
    expect(screen.queryByTestId("basemap-btn-satellite")).toBeNull();
    // Menu fermé au repos (le popover DS ne rend son contenu qu'à l'ouverture).
    expect(screen.queryByRole("menuitemradio", { name: "Plan" })).toBeNull();

    await fireEvent.click(trigger);
    await flushMicrotasks();

    // Ouvert : deux options radio, l'ACTIVE (plan) est cochée ; aria-expanded suit.
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const planOpt = screen.getByRole("menuitemradio", { name: "Plan" });
    const satOpt = screen.getByRole("menuitemradio", { name: "Satellite" });
    expect(planOpt.getAttribute("aria-checked")).toBe("true");
    expect(satOpt.getAttribute("aria-checked")).toBe("false");

    // §5 R4 B — markup DS MENU-ROW : chaque option porte une colonne « coche »
    // RÉSERVÉE (span `.basemap-menu__check`, `aria-hidden`, contenant le glyph
    // lucide `Check`) + un label span (`.basemap-menu__label`). L'ACTIF n'est PAS
    // un aplat de couleur : il se marque par la coche (rendue dans la colonne
    // réservée) + le label weight 500. Le nom accessible reste le libellé SEUL (la
    // coche est `aria-hidden`), d'où `getByRole(..., { name: "Plan" })` ci-dessus.
    for (const opt of [planOpt, satOpt]) {
      const check = opt.querySelector(".basemap-menu__check");
      const label = opt.querySelector(".basemap-menu__label");
      expect(check).not.toBeNull();
      expect(check?.getAttribute("aria-hidden")).toBe("true");
      expect(check?.querySelector("svg")).not.toBeNull(); // glyph lucide Check
      expect(label).not.toBeNull();
    }
    expect(
      planOpt.querySelector(".basemap-menu__label")?.textContent,
    ).toBe("Plan");
    expect(
      satOpt.querySelector(".basemap-menu__label")?.textContent,
    ).toBe("Satellite");

    // Sélection Satellite → writer unique onBasemapModeChange (le socle ne persiste pas).
    await fireEvent.click(satOpt);
    expect(onBasemapModeChange).toHaveBeenCalledWith("satellite");
  });

  it("showBasemapControl=false (défaut) : aucun trigger Fond de carte (route plan-only)", async () => {
    render(GeoCityMapBase, {
      props: { fillColorExpression: FILL_COLOR },
    });
    await flushMicrotasks();

    expect(screen.queryByTestId("basemap-control")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Fond de carte/ }),
    ).toBeNull();
  });
});
