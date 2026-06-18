import { describe, expect, it } from "vitest";
import {
  buildFallbackZoneKey,
  buildGeoQuery,
  buildGeoRoute,
  isFallbackZoneKey,
  parseGeoQuery,
  parseGeoRoute,
} from "./geo-route.js";

describe("geo route paths", () => {
  it("builds canonical geo routes with mode as query state", () => {
    expect(buildGeoRoute({ level: "region" })).toBe(
      "/geo/region/quebec?mode=signal",
    );
    expect(
      buildGeoRoute({
        level: "city",
        citySlug: "plaisance",
        state: { mode: "data" },
      }),
    ).toBe("/geo/city/plaisance?mode=data");
    expect(
      buildGeoRoute({
        level: "zone",
        citySlug: "plaisance",
        zoneKey: "H-123",
      }),
    ).toBe("/geo/zone/plaisance/H-123?mode=signal");
  });

  it("keeps fallback zone keys explicit and URL encoded", () => {
    const zoneKey = buildFallbackZoneKey("salaberry-de-valleyfield");

    expect(zoneKey).toBe("fallback:salaberry-de-valleyfield");
    expect(isFallbackZoneKey(zoneKey, "salaberry-de-valleyfield")).toBe(true);
    expect(
      buildGeoRoute({
        level: "zone",
        citySlug: "salaberry-de-valleyfield",
        zoneKey,
        state: { mode: "data" },
      }),
    ).toBe(
      "/geo/zone/salaberry-de-valleyfield/fallback%3Asalaberry-de-valleyfield?mode=data",
    );
  });

  it("decodes city slugs and zone keys from route segments", () => {
    const result = parseGeoRoute(
      "/geo/zone/salaberry-de-valleyfield/fallback%3Asalaberry-de-valleyfield?mode=data",
    );

    expect(result).toEqual({
      ok: true,
      route: {
        level: "zone",
        citySlug: "salaberry-de-valleyfield",
        zoneKey: "fallback:salaberry-de-valleyfield",
        state: {
          mode: "data",
          selected: [],
          focused: null,
          filters: {},
          viewport: null,
          openPanelSections: [],
        },
      },
    });
  });

  it("rejects unsupported or malformed geo paths explicitly", () => {
    expect(parseGeoRoute("/#/signaux")).toEqual({
      ok: false,
      issue: "not-geo-route",
    });
    expect(parseGeoRoute("/geo/region/montreal")).toEqual({
      ok: false,
      issue: "unsupported-region",
    });
    expect(parseGeoRoute("/geo/zone/plaisance")).toEqual({
      ok: false,
      issue: "missing-zone-key",
    });
    expect(parseGeoRoute("/geo/zone/plaisance/%E0%A4%A")).toEqual({
      ok: false,
      issue: "invalid-path-encoding",
    });
  });
});

describe("geo route query state", () => {
  it("round-trips selected ids, focus, filters, viewport, and panels", () => {
    const query = buildGeoQuery({
      mode: "data",
      selected: [
        { kind: "zone", id: "fallback:plaisance" },
        { kind: "lot", id: "4 516:943" },
      ],
      focused: { kind: "zone", id: "fallback:plaisance" },
      filters: {
        severity: ["medium", "high", "high"],
        source: ["pv"],
      },
      viewport: {
        lng: -73.8000006,
        lat: 45.3166674,
        zoom: 12.5,
        bearing: -0,
        pitch: 45,
      },
      openPanelSections: ["lots", "evidence", "evidence"],
    });

    expect(query).toBe(
      "?mode=data&selected=lot%3A4+516%3A943&selected=zone%3Afallback%3Aplaisance&focused=zone%3Afallback%3Aplaisance&filter.severity=high&filter.severity=medium&filter.source=pv&viewport=-73.800001%2C45.316667%2C12.5%2C0%2C45&panel=evidence&panel=lots",
    );
    expect(parseGeoQuery(query)).toEqual({
      mode: "data",
      selected: [
        { kind: "lot", id: "4 516:943" },
        { kind: "zone", id: "fallback:plaisance" },
      ],
      focused: { kind: "zone", id: "fallback:plaisance" },
      filters: {
        severity: ["high", "medium"],
        source: ["pv"],
      },
      viewport: {
        lng: -73.800001,
        lat: 45.316667,
        zoom: 12.5,
        bearing: 0,
        pitch: 45,
      },
      openPanelSections: ["evidence", "lots"],
    });
  });

  it("defaults invalid query values without failing the route", () => {
    expect(
      parseGeoQuery(
        "?mode=other&selected=bogus%3A1&selected=signal%3Asig-1&focused=lot&viewport=not-a-map",
      ),
    ).toEqual({
      mode: "signal",
      selected: [{ kind: "signal", id: "sig-1" }],
      focused: null,
      filters: {},
      viewport: null,
      openPanelSections: [],
    });
  });
});
