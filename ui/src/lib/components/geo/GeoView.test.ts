import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { activePageState, initRouter, parseGeoQuery } from "$lib/router/router.js";

vi.mock("@sentropic/geo-ui-svelte", async () => {
  const { default: Stub } = await import("../maps/test-stubs/GeoCityMapBaseStub.svelte");
  return { GeoMap: Stub, GeoDetailPanel: Stub };
});
vi.mock("./geo-client.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./geo-client.js")>(),
  fetchGeoCities: vi.fn(async () => ({ ok: true, cities: ["salaberry-de-valleyfield", "val-des-monts"].map(citySlug => ({ citySlug, zoneCount: 1, lotCount: 0, signalCount: 1 })) })),
  fetchGeoFeatures: vi.fn(async (citySlug: string) => ({ ok: true, citySlug,
    zoneCount: 0, lotCount: 0, opportuniteCount: 0,
    zones: { type: "FeatureCollection", features: [] }, lots: { type: "FeatureCollection", features: [] }, opportunites: { type: "FeatureCollection", features: [] },
  })),
}));
import GeoView from "./GeoView.svelte";

beforeEach(() => {
  window.history.replaceState(null, "", "/#/geo");
  activePageState.set(parseGeoQuery(""));
});
afterEach(() => { cleanup(); activePageState.set(parseGeoQuery("")); });

describe("Geo municipality URL", () => {
  it("restores the shared city instead of replacing it with the first available city", async () => {
    window.history.replaceState(null, "", "/#/geo?selected=municipality%3Aval-des-monts");
    activePageState.set(parseGeoQuery("?selected=municipality:val-des-monts"));
    const stopRouter = initRouter();
    render(GeoView);
    const selector = await screen.findByRole("combobox", { name: "Municipalité" });
    expect((selector as HTMLSelectElement).value).toBe("val-des-monts");
    await fireEvent.change(selector, { target: { value: "salaberry-de-valleyfield" } });
    expect(window.location.hash).toContain("selected=municipality%3Asalaberry-de-valleyfield");
    window.history.replaceState(null, "", "/#/geo?selected=municipality%3Aval-des-monts");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => expect((selector as HTMLSelectElement).value).toBe("val-des-monts"));
    stopRouter();
  });

  it("serializes the existing initial default city", async () => {
    render(GeoView);
    await screen.findByRole("combobox", { name: "Municipalité" });
    expect(window.location.hash).toContain("selected=municipality%3Asalaberry-de-valleyfield");
  });
});
