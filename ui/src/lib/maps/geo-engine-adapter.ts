/**
 * Adapter DS immo ↔ moteur carto renderer-neutre GELÉ (`@sentropic/geo-map-engine`, contrat v1
 * ADR-0026, freeze `79fab3fd`). L'adapter se contente de BINDER : props → appels moteur, events
 * moteur → framework, et résout les tokens DS (`--st-*`) → {@link TokenMap}. Il ne duplique
 * AUCUNE logique de rendu (§1.1) ; le moteur possède tout DANS le host (jamais unmount/reparent).
 *
 * Modèle de binding (SPEC_GEO_ENGINE_ADAPTER_BINDING) : l'implémentation du moteur land
 * incrémentalement (Phase 0). Ici le `mount` est INJECTÉ (`MountGeoMap<HTMLElement>`) — un mock
 * contract-conformant en test, le vrai moteur en prod à son landing — donc l'adapter ne change
 * PAS au swap. `renderer` par défaut `'2d'` : le rendu 3D land plus tard (`mount` lève
 * `PENDING_3D` si `renderer==='3d'` aujourd'hui) et se substitue sans toucher cet adapter.
 */
import type {
  MountGeoMap,
  GeoMapHandle,
  GeoMapEvents,
  GeoViewport,
  RendererKind,
  TokenMap,
  BasemapSpec,
  GeoLayerSpec,
} from "@sentropic/geo-map-engine";

/** Config de montage : données de la vue (déjà servies) traduites en specs du contrat gelé. */
export interface GeoEngineMountConfig extends GeoMapEvents {
  basemap: BasemapSpec;
  layers: readonly GeoLayerSpec[];
  viewport: GeoViewport;
  /** Tokens DS résolus (rôle → primitive) — cf. {@link resolveDsTokens}. */
  tokens: TokenMap;
  /** Renderer initial. Défaut `'2d'` (le 3D land plus tard — PENDING_3D). */
  renderer?: RendererKind;
}

/**
 * Résout des rôles de tokens DS en {@link TokenMap} depuis les custom properties `--st-<role>`
 * calculées sur `host`. Le moteur est DOM-free : c'est l'adapter qui lit le DOM (arbitrage E.1),
 * au montage ET à chaque changement de thème. Un rôle sans valeur résolue est omis (jamais `""`).
 */
export function resolveDsTokens(host: HTMLElement, roles: readonly string[]): TokenMap {
  const style = getComputedStyle(host);
  const tokens: TokenMap = {};
  for (const role of roles) {
    const value = style.getPropertyValue(`--st-${role}`).trim();
    if (value) tokens[role] = value;
  }
  return tokens;
}

/**
 * Monte le moteur (via le `mount` injecté) dans `host` et renvoie le handle impératif gelé.
 * Le `renderer` défaut `'2d'` ; un `'3d'` explicite est transmis tel quel au moteur (qui lève
 * `PENDING_3D` tant que le rendu 3D n'a pas land — l'adapter ne masque rien).
 */
export function mountGeoEngine(
  mount: MountGeoMap<HTMLElement>,
  host: HTMLElement,
  config: GeoEngineMountConfig,
): GeoMapHandle {
  const { basemap, layers, viewport, tokens, renderer, ...events } = config;
  return mount(host, {
    basemap,
    layers,
    viewport,
    renderer: renderer ?? "2d",
    tokens,
    ...events,
  });
}
