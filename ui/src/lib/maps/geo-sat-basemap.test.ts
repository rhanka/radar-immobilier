import { describe, it, expect } from "vitest";
import { isSatelliteBasemapEnabled, SAT_HOST_ALLOWLIST } from "./geo-sat-basemap.js";

describe("isSatelliteBasemapEnabled — activation runtime par host (image unique)", () => {
  it("ON sur les hosts allowlistés (préprod + dev local)", () => {
    expect(isSatelliteBasemapEnabled("preprod.immo.sent-tech.ca", false)).toBe(true);
    expect(isSatelliteBasemapEnabled("localhost", false)).toBe(true);
    expect(isSatelliteBasemapEnabled("127.0.0.1", false)).toBe(true);
  });

  it("OFF en prod (immo.sent-tech.ca) et tout host non listé", () => {
    expect(isSatelliteBasemapEnabled("immo.sent-tech.ca", false)).toBe(false);
    expect(isSatelliteBasemapEnabled("example.com", false)).toBe(false);
  });

  it("kill-switch build (VITE_GEO_SAT_BASEMAP=false) force OFF même sur un host allowlisté", () => {
    expect(isSatelliteBasemapEnabled("preprod.immo.sent-tech.ca", true)).toBe(false);
    expect(isSatelliteBasemapEnabled("localhost", true)).toBe(false);
  });

  it("hostname absent (SSR/tests sans DOM) ⇒ OFF (fail-safe)", () => {
    expect(isSatelliteBasemapEnabled(null, false)).toBe(false);
    expect(isSatelliteBasemapEnabled(undefined, false)).toBe(false);
    expect(isSatelliteBasemapEnabled("", false)).toBe(false);
  });

  it("la prod n'est PAS dans l'allowlist (garde-fou)", () => {
    expect(SAT_HOST_ALLOWLIST.has("immo.sent-tech.ca")).toBe(false);
    expect(SAT_HOST_ALLOWLIST.has("preprod.immo.sent-tech.ca")).toBe(true);
  });
});
