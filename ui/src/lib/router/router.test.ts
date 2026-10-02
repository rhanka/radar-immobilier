import { get } from "svelte/store";
import { afterEach, describe, expect, it, vi } from "vitest";

async function loadRouterAt(path: string) {
  window.history.replaceState(null, "", path);
  vi.resetModules();
  return import("./router.js");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("router compatibility", () => {
  it("should canonicalize old links while retaining residual-vivier axes", async () => {
    const router = await loadRouterAt("/geo/city/val-des-monts?filter.subset=vivier-v2%7C-z%7C-p");
    const cleanup = router.initRouter();
    expect(Object.fromEntries(new URLSearchParams(window.location.search))).toEqual({
      mode: "signal", "filter.residentiel": "1", "filter.excludePiia": "1",
      "filter.excludeDerogations": "1", "filter.period": "6mo",
    });
    expect(get(router.activeGeoRoute)?.state.filters).toEqual({
      residentiel: ["1"], excludePiia: ["1"], excludeDerogations: ["1"], period: ["6mo"],
    });
    expect(window.location.search).not.toContain("subset");
    cleanup();
  });

  it("should canonicalize old zones-only links with the defaults they used to show", async () => {
    for (const legacy of ["lots=0", "layers=zones"]) {
      const router = await loadRouterAt(`/geo/city/val-des-monts?${legacy}`);
      const cleanup = router.initRouter();
      expect(Object.fromEntries(new URLSearchParams(window.location.search))).toEqual({
        mode: "signal", "filter.zonage": "1", "filter.residentiel": "1", "filter.precoce": "1",
        "filter.excludePiia": "1", "filter.excludeDerogations": "1", "filter.period": "6mo", "filter.lots": "0",
      });
      expect(get(router.activeGeoRoute)?.state.filters).not.toHaveProperty("legacyLayers");
      cleanup();
    }
  });

  it("should keep shared filters when a bare /geo link is canonicalized to the region", async () => {
    const router = await loadRouterAt(
      "/geo?mode=signal&filter.dateFrom=2026-09-28&filter.dateTo=2026-10-01&filter.dateBasis=scrap&filter.residentiel=0#/geo",
    );
    const cleanup = router.initRouter();
    expect(window.location.pathname).toBe("/geo/region/quebec");
    expect(window.location.hash).toBe("#/geo");
    expect(Object.fromEntries(new URLSearchParams(window.location.search))).toEqual({
      mode: "signal", "filter.dateFrom": "2026-09-28", "filter.dateTo": "2026-10-01",
      "filter.dateBasis": "scrap", "filter.residentiel": "0",
    });
    const route = get(router.activeGeoRoute);
    expect(route).toMatchObject({ level: "region", region: "quebec" });
    expect(route?.state.filters).toEqual({
      dateFrom: ["2026-09-28"], dateTo: ["2026-10-01"], dateBasis: ["scrap"], residentiel: ["0"],
    });
    cleanup();
  });

  it("should replace every restriction from the current history URL", async () => {
    const router = await loadRouterAt("/geo/city/plaisance?filter.precoce=1&filter.lotMinArea=1000");
    const cleanup = router.initRouter();
    window.history.replaceState(null, "", "/geo/city/plaisance?filter.dateFrom=2026-06-01&filter.dateTo=2026-06-30");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(get(router.activeGeoRoute)?.state.filters).toEqual({ dateFrom: ["2026-06-01"], dateTo: ["2026-06-30"] });
    cleanup();
  });

  it("should retain the existing hash view when normalizing an old geo link", async () => {
    const router = await loadRouterAt("/geo/city/val-des-monts?filter.subset=vivier-v2#/sources?filter.sourceStatus=verified");
    const cleanup = router.initRouter();
    expect(window.location.hash).toBe("#/sources?filter.sourceStatus=verified");
    expect(get(router.activePageState).filters.sourceStatus).toEqual(["verified"]);
    expect(get(router.activeRouteView)).toBe("sources");
    cleanup();
  });

  it("should restore Sources restrictions from hash history entries", async () => {
    const router = await loadRouterAt("/#/sources?filter.coverageScope=focus30");
    const cleanup = router.initRouter();
    expect(get(router.activePageState).filters.coverageScope).toEqual(["focus30"]);
    router.navigateToPageState("sources", { filters: { sourceStatus: ["verified"] } });
    expect(window.location.hash).toContain("filter.sourceStatus=verified");
    window.history.replaceState(null, "", "/#/sources?filter.sourceSearch=Valleyfield");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(get(router.activePageState).filters).toEqual({ sourceSearch: ["Valleyfield"] });
    cleanup();
  });
  it("keeps initializing the legacy hash route outside geo paths", async () => {
    const router = await loadRouterAt("/");

    const cleanup = router.initRouter();

    expect(window.location.pathname).toBe("/");
    expect(window.location.hash).toBe("#/signaux");
    expect(get(router.activeRouteView)).toBe("signaux");
    expect(get(router.activeGeoRoute)).toBeNull();

    cleanup();
  });

  it("does not append a legacy hash to canonical geo routes", async () => {
    const router = await loadRouterAt("/geo/city/plaisance?mode=data");

    const cleanup = router.initRouter();

    expect(window.location.pathname).toBe("/geo/city/plaisance");
    expect(window.location.search).toBe("?mode=data");
    expect(window.location.hash).toBe("");
    expect(get(router.activeRouteView)).toBe("signaux");
    expect(get(router.activeGeoRoute)).toMatchObject({
      level: "city",
      citySlug: "plaisance",
      state: { mode: "data" },
    });

    cleanup();
  });

  it("pushes canonical geo URLs without changing the legacy view store", async () => {
    const router = await loadRouterAt("/#/signaux");

    router.navigateToGeoRoute({
      level: "zone",
      citySlug: "plaisance",
      zoneKey: router.buildFallbackZoneKey("plaisance"),
      state: { mode: "data" },
    });

    expect(window.location.pathname).toBe("/geo/zone/plaisance/fallback%3Aplaisance");
    expect(window.location.search).toBe("?mode=data");
    expect(window.location.hash).toBe("");
    expect(get(router.activeRouteView)).toBe("signaux");
    expect(get(router.activeGeoRoute)).toMatchObject({
      level: "zone",
      citySlug: "plaisance",
      zoneKey: "fallback:plaisance",
      state: { mode: "data" },
    });
  });
});
