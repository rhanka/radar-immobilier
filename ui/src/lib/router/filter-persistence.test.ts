/**
 * QA léger — persistance filtre : URL (filter.subset) ↔ localStorage.
 *
 * La logique subsetKeyFromRoute vit dans SignauxMapView.svelte (privée), mais
 * le contrat observable est :
 *   1. parseGeoQuery lit les valeurs de filter.subset
 *   2. localStorage["signaux-filter-subset"] est lu en repli si pas d'URL
 *   3. Le rail « Référence A » est RETIRÉ : le défaut ET toute clé A résiduelle
 *      (URL ou localStorage) migrent vers B (`vivier-v2`) — jamais un rail blanc
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
const FILTER_DEFAULT = "vivier-v2";

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

describe("subsetKeyFromRoute — priorité URL > localStorage > défaut (migration A→B)", () => {
  it("URL hybride z|m migre vers B", () => {
    const state = parseGeoQuery("?filter.subset=z&filter.subset=m");
    expect(subsetKeyFromRoute(state)).toBe("vivier-v2");
  });

  it("URL A exacte (z|m|p) migre vers B — le rail A est retiré", () => {
    const state = parseGeoQuery("?filter.subset=z&filter.subset=m&filter.subset=p");
    expect(subsetKeyFromRoute(state)).toBe("vivier-v2");
  });

  it("URL B exacte gagne sur une préférence A legacy stockée", () => {
    localStorage.setItem(FILTER_LS_KEY, "z|m|p");
    const state = parseGeoQuery("?filter.subset=vivier-v2");
    expect(subsetKeyFromRoute(state)).toBe("vivier-v2");
  });

  it("URL z|p migre vers B (régression #375 jamais réactivable, A retiré)", () => {
    localStorage.setItem(FILTER_LS_KEY, "vivier-v2");
    const state = parseGeoQuery("?filter.subset=z&filter.subset=p");
    expect(subsetKeyFromRoute(state)).toBe("vivier-v2");
  });

  it("URL présente migre vers B et garde priorité sur localStorage", () => {
    localStorage.setItem(FILTER_LS_KEY, "m");
    const state = parseGeoQuery("?filter.subset=z");
    expect(subsetKeyFromRoute(state)).toBe("vivier-v2");
  });

  it("localStorage A legacy → B", () => {
    localStorage.setItem(FILTER_LS_KEY, "z");
    const state = parseGeoQuery("?mode=real");
    expect(subsetKeyFromRoute(state)).toBe("vivier-v2");
  });

  it("localStorage hybride A → B", () => {
    localStorage.setItem(FILTER_LS_KEY, "z|m");
    const emptyFiltersState = normalizeGeoRouteState({});
    expect(subsetKeyFromRoute(emptyFiltersState)).toBe("vivier-v2");
  });

  it("reload sans subset URL conserve B depuis localStorage après chargement", () => {
    localStorage.setItem(FILTER_LS_KEY, "vivier-v2");
    const state = normalizeGeoRouteState({});
    const route: GeoRoute = { level: "region", region: "quebec", state };
    const initial = initialVivierSubsetKey(route, localStorage.getItem(FILTER_LS_KEY));

    expect(initial).toBe("vivier-v2");
    expect(reconcileVivierRouteSubset(route, initial)).toBe("vivier-v2");
  });

  it("CRITIQUE — une préférence z|p stockée migre vers B au reload (jamais un blanc)", () => {
    localStorage.setItem(FILTER_LS_KEY, "z|p");
    const state = normalizeGeoRouteState({});
    const route: GeoRoute = { level: "region", region: "quebec", state };
    const initial = initialVivierSubsetKey(route, localStorage.getItem(FILTER_LS_KEY));

    expect(initial).toBe("vivier-v2");
    expect(reconcileVivierRouteSubset(route, initial)).toBe("vivier-v2");
  });

  it("pas de subset dans URL, aucun localStorage → B (défaut)", () => {
    const emptyFiltersState = normalizeGeoRouteState({});
    expect(subsetKeyFromRoute(emptyFiltersState)).toBe(FILTER_DEFAULT);
  });

  it("route=null → B (défaut)", () => {
    expect(subsetKeyFromRoute(null)).toBe(FILTER_DEFAULT);
  });

  it("route=null, localStorage A legacy → B", () => {
    localStorage.setItem(FILTER_LS_KEY, "z");
    expect(subsetKeyFromRoute(null)).toBe("vivier-v2");
  });

  it("localStorage vide (espace seul) → ignoré, retourne le défaut B", () => {
    localStorage.setItem(FILTER_LS_KEY, "   ");
    expect(subsetKeyFromRoute(null)).toBe(FILTER_DEFAULT);
  });
});
