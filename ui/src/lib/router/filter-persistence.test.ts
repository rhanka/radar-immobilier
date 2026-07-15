/**
 * QA léger — persistance filtre : URL (filter.subset) ↔ localStorage.
 *
 * La logique subsetKeyFromRoute vit dans SignauxMapView.svelte (privée), mais
 * le contrat observable est :
 *   1. parseGeoQuery lit les valeurs de filter.subset
 *   2. localStorage["signaux-filter-subset"] est lu en repli si pas d'URL
 *   3. Le défaut est A (`z|m|p`) ; seul `z|p` explicite active la transition
 *
 * Ce test valide le contrat en utilisant directement parseGeoQuery (exporté).
 *
 * Aucun docker, aucune API, aucun composant Svelte.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseGeoQuery, normalizeGeoRouteState } from "./geo-route.js";
import { modeFromSubsetKey, subsetKeyForMode } from "$lib/signals/vivier-view-mode.js";

// ── Helpers ────────────────────────────────────────────────────────��─────────

const FILTER_LS_KEY = "signaux-filter-subset";
const FILTER_DEFAULT = "z|m|p";

function canonicalSubsetKey(raw: string): string {
  return subsetKeyForMode(modeFromSubsetKey(raw));
}

/**
 * Réplique du contrat subsetKeyFromRoute de SignauxMapView.
 * Source de vérité : SignauxMapView.svelte.
 */
function subsetKeyFromRoute(route: ReturnType<typeof parseGeoQuery> | null): string {
  if (route) {
    const values = route.filters["subset"] ?? [];
    if (values.length > 0) return canonicalSubsetKey(values.join("|"));
  }
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(FILTER_LS_KEY);
    if (stored && stored.trim().length > 0) return canonicalSubsetKey(stored.trim());
  }
  return FILTER_DEFAULT;
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

  it("URL transition exacte z|p gagne sur localStorage A", () => {
    localStorage.setItem(FILTER_LS_KEY, "z|m|p");
    const state = parseGeoQuery("?filter.subset=z&filter.subset=p");
    expect(subsetKeyFromRoute(state)).toBe("z|p");
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
