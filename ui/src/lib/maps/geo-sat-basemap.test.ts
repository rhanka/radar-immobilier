import { describe, it, expect } from "vitest";
import {
  isSatelliteBasemapEnabled,
  resolveMintUrl,
  SAT_HOST_ALLOWLIST,
} from "./geo-sat-basemap.js";

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

describe("resolveMintUrl — dérivation runtime de la mint URL par host (image unique)", () => {
  it("préprod (sans override) → mint préprod", () => {
    expect(resolveMintUrl("preprod.immo.sent-tech.ca")).toBe(
      "https://api.preprod.geo.sent-tech.ca/basemap/2d/session",
    );
  });

  it("prod immo.sent-tech.ca (sans override) → mint prod", () => {
    expect(resolveMintUrl("immo.sent-tech.ca")).toBe(
      "https://api.geo.sent-tech.ca/basemap/2d/session",
    );
  });

  it("override VITE_GEO_SAT_MINT_URL prioritaire → renvoyé tel quel quel que soit le host", () => {
    expect(resolveMintUrl("immo.sent-tech.ca", "https://exemple.test/mint")).toBe(
      "https://exemple.test/mint",
    );
    expect(
      resolveMintUrl("preprod.immo.sent-tech.ca", "https://exemple.test/mint"),
    ).toBe("https://exemple.test/mint");
  });

  it("localhost (dev) → mint préprod", () => {
    expect(resolveMintUrl("localhost")).toBe(
      "https://api.preprod.geo.sent-tech.ca/basemap/2d/session",
    );
  });

  it("hostname absent (SSR/tests sans DOM, sans override) → mint préprod (fail-safe)", () => {
    expect(resolveMintUrl(null)).toBe(
      "https://api.preprod.geo.sent-tech.ca/basemap/2d/session",
    );
    expect(resolveMintUrl(undefined)).toBe(
      "https://api.preprod.geo.sent-tech.ca/basemap/2d/session",
    );
  });
});
