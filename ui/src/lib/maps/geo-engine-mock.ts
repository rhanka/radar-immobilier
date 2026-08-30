/**
 * Mock contract-conformant de `MountGeoMap<HTMLElement>` (contrat gelé v1 du moteur carto
 * renderer-neutre). DOM-free, zéro renderer réel : sert à BINDER et TESTER l'adapter DS immo
 * AVANT le landing du vrai moteur (Phase 0). Il enregistre l'état déclaratif
 * (layers/basemap/viewport/renderer/tokens) et la trace des appels impératifs pour l'assertion ;
 * le vrai moteur le remplace sans changer l'adapter (swap contract-conformant).
 */
import type {
  MountGeoMap,
  GeoMapHandle,
  GeoViewport,
  RendererKind,
  TokenMap,
  BasemapSpec,
  GeoLayerSpec,
  GeoFeatureHit,
  GeoBounds,
} from "@sentropic/geo-map-engine";

/** État observable du mock (pour les assertions du test de conformité). */
export interface MockGeoMapState {
  mounted: boolean;
  host: HTMLElement | null;
  basemap: BasemapSpec | null;
  layers: readonly GeoLayerSpec[];
  viewport: GeoViewport | null;
  renderer: RendererKind | null;
  tokens: TokenMap;
  /** Trace ordonnée des méthodes appelées (mount + handle). */
  calls: string[];
}

export interface MockGeoMap {
  mount: MountGeoMap<HTMLElement>;
  state: MockGeoMapState;
}

/** Crée un mock du moteur : un `mount` conforme au contrat + l'état qu'il enregistre. */
export function createMockGeoMap(): MockGeoMap {
  const state: MockGeoMapState = {
    mounted: false,
    host: null,
    basemap: null,
    layers: [],
    viewport: null,
    renderer: null,
    tokens: {},
    calls: [],
  };

  const mount: MountGeoMap<HTMLElement> = (host, opts) => {
    state.mounted = true;
    state.host = host;
    state.basemap = opts.basemap;
    state.layers = opts.layers;
    state.viewport = opts.viewport;
    state.renderer = opts.renderer;
    state.tokens = opts.tokens;
    state.calls.push("mount");
    // Le contrat n'impose pas le timing d'`onReady` ; le mock l'appelle synchroniquement.
    opts.onReady?.();

    const handle: GeoMapHandle = {
      setLayers: (layers) => {
        state.layers = layers;
        state.calls.push("setLayers");
      },
      setBasemap: (basemap) => {
        state.basemap = basemap;
        state.calls.push("setBasemap");
      },
      setViewport: (viewport) => {
        state.viewport = viewport;
        state.calls.push("setViewport");
      },
      setRenderer: (renderer) => {
        state.renderer = renderer;
        state.calls.push("setRenderer");
      },
      setTokens: (tokens) => {
        state.tokens = tokens;
        state.calls.push("setTokens");
      },
      flyTo: (viewport) => {
        if (state.viewport) state.viewport = { ...state.viewport, ...viewport };
        state.calls.push("flyTo");
      },
      fitBounds: () => {
        state.calls.push("fitBounds");
      },
      recenterKeepZoom: (center) => {
        if (state.viewport) state.viewport = { ...state.viewport, center };
        state.calls.push("recenterKeepZoom");
      },
      resetToInitialView: () => {
        state.calls.push("resetToInitialView");
      },
      syncLayers: (layers) => {
        state.layers = layers;
        state.calls.push("syncLayers");
      },
      queryRenderedFeatures: (): readonly GeoFeatureHit[] => [],
      getFeatureBoundary: (): GeoBounds | null => null,
      destroy: () => {
        state.mounted = false;
        state.calls.push("destroy");
      },
    };
    return handle;
  };

  return { mount, state };
}
