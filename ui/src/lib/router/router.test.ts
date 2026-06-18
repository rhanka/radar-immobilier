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
