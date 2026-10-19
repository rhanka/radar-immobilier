import { describe, expect, it } from "vitest";
import { contentHostAppOption, resolveContentHostConfig } from "./content-config.js";

const resolve = (contentBase?: string) => resolveContentHostConfig({ contentBase });

describe("resolveContentHostConfig", () => {
  it("stays disabled when the variable is unset or empty", () => {
    for (const base of [undefined, "", "   "]) {
      expect(resolve(base)).toEqual({ enabled: false, reason: "content_base_unset" });
    }
  });

  it("accepts a valid base without auth or database prerequisites", () => {
    expect(resolve("pages.example.net")).toEqual({
      enabled: true, contentBase: "pages.example.net",
    });
  });

  it("accepts localhost for local e2e", () => {
    expect(resolve("localhost")).toEqual({ enabled: true, contentBase: "localhost" });
    expect(resolve("  Localhost.  ")).toEqual({ enabled: true, contentBase: "localhost" });
  });

  it("leaves application-domain policy to @sentropic/artifacts", () => {
    for (const base of ["pages.sent-tech.ca", "sent-tech.ca", "preprod.immo.sent-tech.ca"]) {
      expect(resolve(base)).toEqual({ enabled: true, contentBase: base });
    }
  });

  it("normalizes whitespace, case and a DNS root dot", () => {
    expect(resolve("  Pages.Example.NET.  ")).toEqual({
      enabled: true, contentBase: "pages.example.net",
    });
  });

  it("throws on an explicit but malformed base (fail-fast, never silently disabled)", () => {
    const bad = [
      ".",
      "https://x.example.net", "x.example.net:3000", "x.example.net/p",
      "127.0.0.1", "::1", "not a host", "nodot", "-x.example.net",
      "x-.example.net", "x..example.net", "x.example.net..", "x_1.example.net",
      `${"a".repeat(64)}.example.net`, `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}`,
    ];
    for (const base of bad) {
      expect(() => resolve(base), base).toThrow("invalid ARTIFACTS_CONTENT_BASE");
    }
  });
});

describe("contentHostAppOption", () => {
  it("spreads nothing when disabled (index.ts keeps the current chain)", () => {
    expect(contentHostAppOption({ enabled: false, reason: "content_base_unset" })).toEqual({});
  });

  it("spreads the wired contentHost when enabled (index.ts wiring)", () => {
    const resolved = resolve("pages.example.net");
    expect(contentHostAppOption(resolved)).toEqual({ contentHost: resolved });
  });

  it("never sees an invalid base (resolve throws before the wiring)", () => {
    expect(() => contentHostAppOption(resolve("not a host"))).toThrow(
      "invalid ARTIFACTS_CONTENT_BASE",
    );
  });
});
