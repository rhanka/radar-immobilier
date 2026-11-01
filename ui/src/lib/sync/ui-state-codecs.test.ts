import { describe, expect, it } from "vitest";
import { normalizeGeoRouteState } from "../router/geo-route.js";
import { readGeoFilters } from "../router/geo-filter-state.js";
import { decodeContext, projectContext, validTarget } from "./ui-state-codecs.js";
import { context } from "./test-support.js";

describe("context projection and compatibility", () => {
  it("should keep a no-filter URL on product defaults", () => {
    const payload = projectContext({ kind: "page", view: "signaux" }, normalizeGeoRouteState());
    expect(payload.state.filters).toEqual({});
    expect(readGeoFilters(payload.state.filters).axes).toEqual(readGeoFilters({}).axes);
  });
  it("should exclude reveal, arbitrary keys and text while marking the snapshot partial", () => {
    const payload = projectContext({ kind: "page", view: "signaux" }, normalizeGeoRouteState({ filters: {
      period: ["all"], cptaq: ["1"], lots: ["0"], showDiscarded: ["1"], citySearch: ["private text"],
      zoneSearch: ["private"], lotSearch: ["private"], arbitrary: ["secret"],
    } }));
    expect(payload.partial).toBe(true); expect(payload.state.filters).toEqual({ lots: ["0"], cptaq: ["1"] });
    expect(JSON.stringify(payload)).not.toMatch(/private|showDiscarded|arbitrary|secret/);
  });
  it("should preserve unrestricted meaning when only excluded restrictions were present", () => {
    const payload = projectContext({ kind: "page", view: "signaux" }, normalizeGeoRouteState({ filters: { citySearch: ["text"] } }));
    expect(payload.state.filters).toEqual({ period: ["all"] });
  });
  it("should round-trip v1 without mutation and refuse unknown migrations", () => {
    const value = context(); const raw = JSON.stringify(value);
    expect(decodeContext(raw, 1000)).toEqual(value);
    for (const version of ["0.9.0", "1.1.0", "2.0.0"]) {
      const unknown = JSON.stringify({ ...value, schemaVersion: version });
      expect(decodeContext(unknown, 1000)).toBeNull();
    }
    expect(JSON.stringify(value)).toBe(raw);
  });
  it("should fail closed for unsupported targets, sensitive fields, expiry and size", () => {
    expect(validTarget({ kind: "url", url: "https://other.invalid" })).toBe(false);
    expect(validTarget({ kind: "page", view: "unknown" })).toBe(false);
    const value = context();
    expect(decodeContext(JSON.stringify({ ...value, grant: "secret" }), 1000)).toBeNull();
    expect(decodeContext(JSON.stringify(value), value.expiresAt)).toBeNull();
    expect(decodeContext("x".repeat(33 * 1024), 1000)).toBeNull();
    value.payload.state.filters.showDiscarded = ["1"];
    expect(decodeContext(JSON.stringify(value), 1000)).toBeNull();
  });
});
