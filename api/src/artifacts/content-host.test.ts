import { describe, expect, it } from "vitest";
import { parseContentHost } from "./content-host.js";

const BASE = "pages.example.net";
const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE = "123e4567-e89b-12d3-a456-426614174001";
const parse = (host?: string | null, base: string | null | undefined = BASE) =>
  parseContentHost(host, base);

describe("parseContentHost", () => {
  it("classifies <artifactUuid>.<base> as the stable channel", () => {
    expect(parse(`${ARTIFACT}.${BASE}`)).toEqual({
      kind: "stable", artifactId: ARTIFACT,
    });
  });

  it("classifies <releaseUuid>.pinned.<base> as the pinned channel", () => {
    expect(parse(`${RELEASE}.pinned.${BASE}`)).toEqual({
      kind: "pinned", releaseId: RELEASE,
    });
  });

  it("ignores case and a port suffix", () => {
    expect(parse(`${ARTIFACT}.${BASE}:3000`)).toEqual({
      kind: "stable", artifactId: ARTIFACT,
    });
    expect(parse(`${RELEASE}.PINNED.${BASE.toUpperCase()}`)).toEqual({
      kind: "pinned", releaseId: RELEASE,
    });
  });

  it("refuses two UUID labels (ambiguous, neither stable nor pinned)", () => {
    expect(parse(`${ARTIFACT}.${RELEASE}.${BASE}`)).toEqual({ kind: "other" });
  });

  it("refuses a single label concatenating two UUIDs", () => {
    expect(parse(`${ARTIFACT}-${RELEASE}.${BASE}`)).toEqual({ kind: "other" });
  });

  it("accepts a single DNS root dot on host and base", () => {
    expect(parse(`${ARTIFACT}.${BASE}.`)).toEqual({
      kind: "stable", artifactId: ARTIFACT,
    });
    expect(parse(`${ARTIFACT}.${BASE}`, `${BASE}.`)).toEqual({
      kind: "stable", artifactId: ARTIFACT,
    });
  });

  it("refuses an otherwise stable host past 253 characters", () => {
    const longBase = `${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(34)}`;
    expect(`${ARTIFACT}.${longBase}`).toHaveLength(254);
    expect(parse(`${ARTIFACT}.${longBase}`, longBase)).toEqual({ kind: "other" });
  });

  it("refuses extra labels", () => {
    for (const host of [`extra.${ARTIFACT}.${BASE}`, `a.b.${BASE}`, `.${BASE}`]) {
      expect(parse(host), host).toEqual({ kind: "other" });
    }
  });

  it("refuses non-UUID labels", () => {
    for (const host of [`not-a-uuid.${BASE}`, `nope.pinned.${BASE}`]) {
      expect(parse(host), host).toEqual({ kind: "other" });
    }
  });

  it("refuses a foreign base and the bare base apex", () => {
    expect(parse(`${ARTIFACT}.other.test`)).toEqual({ kind: "other" });
    expect(parse(BASE)).toEqual({ kind: "other" });
    expect(parse("preprod.immo.sent-tech.ca")).toEqual({ kind: "other" });
  });

  it("refuses when the base is absent or the host is empty", () => {
    expect(parseContentHost(`${ARTIFACT}.${BASE}`, undefined)).toEqual({ kind: "other" });
    expect(parse(`${ARTIFACT}.${BASE}`, null)).toEqual({ kind: "other" });
    expect(parse(`${ARTIFACT}.${BASE}`, "")).toEqual({ kind: "other" });
    expect(parse(undefined)).toEqual({ kind: "other" });
    expect(parse("")).toEqual({ kind: "other" });
  });
});
