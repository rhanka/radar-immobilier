/**
 * QA léger — persistance filtre : URL (filter.subset) ↔ localStorage.
 *
 * La logique subsetKeyFromRoute vit dans SignauxMapView.svelte (privée), mais
 * le contrat observable est :
 *   1. parseGeoQuery lit les valeurs de filter.subset
 *   2. localStorage["signaux-filter-subset"] est lu en repli si pas d'URL
 *   3. Le défaut est A (`z|m|p`) ; seule la clé `vivier-v2` explicite active B
 *
 * Ce test valide le contrat en utilisant directement parseGeoQuery (exporté).
 *
 * Aucun docker, aucune API, aucun composant Svelte.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseGeoQuery, normalizeGeoRouteState } from "./geo-route.js";
import {
  initialVivierSubsetKey,
  reconcileVivierRouteSubset,
} from "$lib/signals/vivier-view-mode.js";
import type { GeoRoute } from "./geo-route.js";

// ── Helpers ────────────────────────────────────────────────────────��─────────

const FILTER_LS_KEY = "signaux-filter-subset";
const FILTER_DEFAULT = "z|m|p";

function subsetKeyFromRoute(route: ReturnType<typeof parseGeoQuery> | null): string {
  const geoRoute: GeoRoute | null = route
    ? { level: "region", region: "quebec", state: route }
    : null;
  return initialVivierSubsetKey(geoRoute, localStorage.getItem(FILTER_LS_KEY));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

// ── parseGeoQuery : lecture filter.subset ────────────────────────────────────

describe("parseGeoQuery — lecture filter.subset", () => {
  it("filter.subset=z → filters.subset contient 'z' (1 valeur)", () => {
    const state = parseGeoQuery("?filter.subset=z");
    expect(state.filters["subset"]).toHaveLength(1);
    expect(state.filters["subset"]).toContain("z");
  });

  it("filter.subset=z&filter.subset=m → filters.subset contient 'z' et 'm' (2 valeurs)", () => {
    const state = parseGeoQuery("?filter.subset=z&filter.subset=m");
    const subset = state.filters["subset"];
    expect(subset).toHaveLength(2);
    expect(subset).toContain("z");
    expect(subset).toContain("m");
  });

  it("filter.subset=z&filter.subset=m&filter.subset=p → 3 valeurs z, m, p", () => {
    const state = parseGeoQuery("?filter.subset=z&filter.subset=m&filter.subset=p");
    const subset = state.filters["subset"];
    expect(subset).toHaveLength(3);
    expect(subset).toContain("z");
    expect(subset).toContain("m");
    expect(subset).toContain("p");
  });

  it("aucun filter.subset → filters.subset absent ou vide", () => {
    const state = parseGeoQuery("?mode=real");
    expect(state.filters["subset"] ?? []).toEqual([]);
  });
});

// ── subsetKeyFromRoute : priorité URL > localStorage > défaut ────────────────

describe("subsetKeyFromRoute — priorité URL > localStorage > défaut", () => {
  it("URL hybride z|m revient à A", () => {
    const state = parseGeoQuery("?filter.subset=z&filter.subset=m");
    expect(subsetKeyFromRoute(state)).toBe("z|m|p");
  });

  it("URL A exacte reste z|m|p sans coercition", () => {
    const state = parseGeoQuery("?filter.subset=z&filter.subset=m&filter.subset=p");
    expect(subsetKeyFromRoute(state)).toBe("z|m|p");
  });

  it("URL B exacte gagne sur localStorage A", () => {
    localStorage.setItem(FILTER_LS_KEY, "z|m|p");
    const state = parseGeoQuery("?filter.subset=vivier-v2");
    expect(subsetKeyFromRoute(state)).toBe("vivier-v2");
  });

  it("URL z|p retirée revient à A (régression #375 non réactivable)", () => {
    localStorage.setItem(FILTER_LS_KEY, "vivier-v2");
    const state = parseGeoQuery("?filter.subset=z&filter.subset=p");
    expect(subsetKeyFromRoute(state)).toBe("z|m|p");
  });

  it("URL invalide revient à A et garde priorité sur localStorage", () => {
    localStorage.setItem(FILTER_LS_KEY, "m");
    const state = parseGeoQuery("?filter.subset=z");
    expect(subsetKeyFromRoute(state)).toBe("z|m|p");
  });

  it("localStorage invalide revient à A", () => {
    localStorage.setItem(FILTER_LS_KEY, "z");
    const state = parseGeoQuery("?mode=real");
    expect(subsetKeyFromRoute(state)).toBe("z|m|p");
  });

  it("localStorage hybride revient à A", () => {
    localStorage.setItem(FILTER_LS_KEY, "z|m");
    const emptyFiltersState = normalizeGeoRouteState({});
    expect(subsetKeyFromRoute(emptyFiltersState)).toBe("z|m|p");
  });

  it("reload sans subset URL conserve B depuis localStorage après chargement", () => {
    localStorage.setItem(FILTER_LS_KEY, "vivier-v2");
    const state = normalizeGeoRouteState({});
    const route: GeoRoute = { level: "region", region: "quebec", state };
    const initial = initialVivierSubsetKey(route, localStorage.getItem(FILTER_LS_KEY));

    expect(initial).toBe("vivier-v2");
    expect(reconcileVivierRouteSubset(route, initial)).toBe("vivier-v2");
  });

  it("une préférence z|p stockée retombe sur A au reload", () => {
    localStorage.setItem(FILTER_LS_KEY, "z|p");
    const state = normalizeGeoRouteState({});
    const route: GeoRoute = { level: "region", region: "quebec", state };
    const initial = initialVivierSubsetKey(route, localStorage.getItem(FILTER_LS_KEY));

    expect(initial).toBe("z|m|p");
    expect(reconcileVivierRouteSubset(route, initial)).toBe("z|m|p");
  });

  it("pas de subset dans URL, aucun localStorage → A", () => {
    const emptyFiltersState = normalizeGeoRouteState({});
    expect(subsetKeyFromRoute(emptyFiltersState)).toBe(FILTER_DEFAULT);
  });

  it("route=null → A", () => {
    expect(subsetKeyFromRoute(null)).toBe(FILTER_DEFAULT);
  });

  it("route=null, localStorage invalide → A", () => {
    localStorage.setItem(FILTER_LS_KEY, "z");
    expect(subsetKeyFromRoute(null)).toBe("z|m|p");
  });

  it("localStorage vide (espace seul) → ignoré, retourne défaut", () => {
    localStorage.setItem(FILTER_LS_KEY, "   ");
    expect(subsetKeyFromRoute(null)).toBe(FILTER_DEFAULT);
  });
});
