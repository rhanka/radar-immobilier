import { describe, expect, it } from "vitest";
import {
  belongsToContentDomain,
  belongsToLegacyContentDomain,
  legacyContentRedirectTarget,
  LEGACY_CONTENT_BASE,
  LEGACY_PINNED_BASE,
  parseContentHost,
  parseLegacyContentHost,
} from "./content-host.js";

const BASE = "pages.example.net";
const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE = "123e4567-e89b-12d3-a456-426614174001";
const parse = (host?: string | null, base: string | null | undefined = BASE) =>
  parseContentHost(host, base);

describe("belongsToContentDomain", () => {
  it("should reserve malformed labels, nested labels and the apex", () => {
    for (const host of [BASE, `not-a-uuid.${BASE}`, `nope.${BASE}`, `a.b.${BASE}`, `NOPE.${BASE.toUpperCase()}.:443`, `nope.${BASE}:invalid`, `${ARTIFACT}.${BASE}..`]) {
      expect(belongsToContentDomain(host, BASE), host).toBe(true);
    }
  });
  it("should reserve the retired pinned form without admitting it", () => {
    expect(belongsToContentDomain(`${RELEASE}.pinned.${BASE}`, BASE)).toBe(true);
    expect(parse(`${RELEASE}.pinned.${BASE}`)).toEqual({ kind: "other" });
  });
  it("should preserve foreign hosts and an unconfigured base", () => {
    for (const host of ["app.example.test", `nope.${BASE}.evil.test`, `nope.not${BASE}`, undefined]) {
      expect(belongsToContentDomain(host, BASE)).toBe(false);
    }
    expect(belongsToContentDomain(`nope.${BASE}`, "")).toBe(false);
  });
});

describe("parseContentHost", () => {
  it("classifies a single UUID label as content (stable or exact, resolved server-side)", () => {
    expect(parse(`${ARTIFACT}.${BASE}`)).toEqual({ kind: "content", id: ARTIFACT });
    expect(parse(`${RELEASE}.${BASE}`)).toEqual({ kind: "content", id: RELEASE });
  });

  it("ignores case and a port suffix", () => {
    expect(parse(`${ARTIFACT}.${BASE}:3000`)).toEqual({ kind: "content", id: ARTIFACT });
    expect(parse(`${ARTIFACT}.${BASE.toUpperCase()}`)).toEqual({ kind: "content", id: ARTIFACT });
  });

  it("refuses the retired pinned form and any extra label", () => {
    for (const host of [`${RELEASE}.pinned.${BASE}`, `${ARTIFACT}.${RELEASE}.${BASE}`, `extra.${ARTIFACT}.${BASE}`, `a.b.${BASE}`, `.${BASE}`]) {
      expect(parse(host), host).toEqual({ kind: "other" });
    }
  });

  it("refuses a single label concatenating two UUIDs", () => {
    expect(parse(`${ARTIFACT}-${RELEASE}.${BASE}`)).toEqual({ kind: "other" });
  });

  it("accepts a single DNS root dot on host and base", () => {
    expect(parse(`${ARTIFACT}.${BASE}.`)).toEqual({ kind: "content", id: ARTIFACT });
    expect(parse(`${ARTIFACT}.${BASE}`, `${BASE}.`)).toEqual({ kind: "content", id: ARTIFACT });
  });

  it("refuses an otherwise content host past 253 characters", () => {
    const longBase = `${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(34)}`;
    expect(`${ARTIFACT}.${longBase}`).toHaveLength(254);
    expect(parse(`${ARTIFACT}.${longBase}`, longBase)).toEqual({ kind: "other" });
  });

  it("refuses non-UUID labels", () => {
    for (const host of [`not-a-uuid.${BASE}`, `nope.pinned.${BASE}`]) {
      expect(parse(host), host).toEqual({ kind: "other" });
    }
  });

  it("never parses application hosts as content (app, auth, mcp, apex)", () => {
    for (const host of [BASE, "preprod.immo.sent-tech.ca", "preprod.auth.sent-tech.ca",
      "preprod.immo.sent-tech.ca", "auth.sent-tech.ca", "immo.sent-tech.ca",
      `${ARTIFACT}.other.test`, `api.${BASE}`, `mcp.${BASE}`]) {
      expect(parse(host, BASE), host).toEqual({ kind: "other" });
    }
    // The deployed content base is always `pages.<app>`: a UUID label under
    // the bare app base only parses when that app base is itself configured
    // as the content base, which the overlays never do.
    expect(parse("preprod.immo.sent-tech.ca", BASE)).toEqual({ kind: "other" });
  });

  it("refuses when the base is absent or the host is empty", () => {
    expect(parseContentHost(`${ARTIFACT}.${BASE}`, undefined)).toEqual({ kind: "other" });
    expect(parse(`${ARTIFACT}.${BASE}`, null)).toEqual({ kind: "other" });
    expect(parse(`${ARTIFACT}.${BASE}`, "")).toEqual({ kind: "other" });
    expect(parse(undefined)).toEqual({ kind: "other" });
    expect(parse("")).toEqual({ kind: "other" });
  });
});

describe("legacy immo-pages redirect", () => {
  it("parses both retired host forms", () => {
    expect(parseLegacyContentHost(`${ARTIFACT}.${LEGACY_CONTENT_BASE}`))
      .toEqual({ kind: "legacy-stable", artifactId: ARTIFACT });
    expect(parseLegacyContentHost(`${RELEASE}.${LEGACY_PINNED_BASE}`))
      .toEqual({ kind: "legacy-pinned", releaseId: RELEASE });
  });

  it("refuses malformed legacy labels without redirecting", () => {
    for (const host of [`not-a-uuid.${LEGACY_CONTENT_BASE}`, `nope.${LEGACY_PINNED_BASE}`,
      LEGACY_CONTENT_BASE, LEGACY_PINNED_BASE, `${ARTIFACT}.${RELEASE}.${LEGACY_CONTENT_BASE}`,
      `${ARTIFACT}.${BASE}`, undefined, ""]) {
      expect(parseLegacyContentHost(host)).toBeNull();
      expect(legacyContentRedirectTarget(host, BASE, "/")).toBeNull();
    }
  });

  it("maps both retired forms onto the same UUID label on the new base, path and query preserved", () => {
    expect(legacyContentRedirectTarget(
      `${ARTIFACT}.${LEGACY_CONTENT_BASE}`, BASE, "/__reader/start?x=1"))
      .toBe(`https://${ARTIFACT}.${BASE}/__reader/start?x=1`);
    expect(legacyContentRedirectTarget(
      `${RELEASE}.${LEGACY_PINNED_BASE}`, BASE, "/main.js?grant=abc&citySlug=v"))
      .toBe(`https://${RELEASE}.${BASE}/main.js?grant=abc&citySlug=v`);
    expect(legacyContentRedirectTarget(`${ARTIFACT}.${LEGACY_CONTENT_BASE}:443`, BASE, "/"))
      .toBe(`https://${ARTIFACT}.${BASE}/`);
  });

  it("belongsToLegacyContentDomain reserves the retired domain only", () => {
    expect(belongsToLegacyContentDomain(`${ARTIFACT}.${LEGACY_CONTENT_BASE}`)).toBe(true);
    expect(belongsToLegacyContentDomain(`${RELEASE}.${LEGACY_PINNED_BASE}`)).toBe(true);
    expect(belongsToLegacyContentDomain(`${ARTIFACT}.${BASE}`)).toBe(false);
    expect(belongsToLegacyContentDomain("preprod.immo.sent-tech.ca")).toBe(false);
    expect(belongsToLegacyContentDomain(undefined)).toBe(false);
  });
});
