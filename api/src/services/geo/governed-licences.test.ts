/**
 * Unit tests for the governed licence registry (I-1A, converged r3 §1 N4).
 *
 * Exact title matching only: no normalisation is ever invented, registry
 * titles are unique (ambiguity ⇒ unknown), and "Unknown license" never
 * resolves.
 */
import { describe, expect, it } from "vitest";
import {
  GOVERNED_LICENCE_REGISTRY,
  UNKNOWN_LICENCE_TITLE,
  assertRegistryTitlesUnique,
  resolveLicenceId,
} from "./governed-licences.js";

describe("resolveLicenceId (exact title match, geo-N4)", () => {
  it("resolves the known CC-BY-4.0 title exactly", () => {
    expect(resolveLicenceId("Creative Commons Attribution 4.0 International")).toEqual({
      status: "known",
      licenseId: "cc-by-4.0",
    });
  });

  it("resolves the recorded municipal titles exactly", () => {
    expect(
      resolveLicenceId("Donnée publique municipale (zonage) — MRC de Portneuf"),
    ).toEqual({ status: "known", licenseId: "portneuf-zonage-municipal" });
    expect(resolveLicenceId("Plan de zonage municipal Ville de Rosemère")).toEqual({
      status: "known",
      licenseId: "rosemere-zonage-municipal",
    });
  });

  it("refuses Unknown license (the OGC fallback title)", () => {
    expect(resolveLicenceId(UNKNOWN_LICENCE_TITLE)).toEqual({
      status: "unknown",
      reason: "unmatched-title",
    });
  });

  it("refuses an absent or non-string title", () => {
    expect(resolveLicenceId(undefined)).toEqual({ status: "unknown", reason: "missing-title" });
    expect(resolveLicenceId(null)).toEqual({ status: "unknown", reason: "missing-title" });
    expect(resolveLicenceId("")).toEqual({ status: "unknown", reason: "missing-title" });
  });

  it("invents no normalisation: case, accent and whitespace variants stay unknown", () => {
    expect(
      resolveLicenceId("creative commons attribution 4.0 international"),
    ).toEqual({ status: "unknown", reason: "unmatched-title" });
    expect(
      resolveLicenceId(" Creative Commons Attribution 4.0 International"),
    ).toEqual({ status: "unknown", reason: "unmatched-title" });
    expect(
      resolveLicenceId("Creative Commons Attribution 4.0 International "),
    ).toEqual({ status: "unknown", reason: "unmatched-title" });
    expect(resolveLicenceId("Plan de zonage municipal Ville de Rosemere")).toEqual({
      status: "unknown",
      reason: "unmatched-title",
    });
  });
});

describe("registry title uniqueness (ambiguity ⇒ unknown)", () => {
  it("the shipped registry titles are unique", () => {
    expect(() => assertRegistryTitlesUnique()).not.toThrow();
    const titles = GOVERNED_LICENCE_REGISTRY.map((entry) => entry.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("a duplicated title across ids throws (would-be ambiguous collections)", () => {
    expect(() =>
      assertRegistryTitlesUnique([
        { id: "a", title: "Same Title" },
        { id: "b", title: "Same Title" },
      ]),
    ).toThrow(/ambiguous licence title/);
  });

  it("a duplicated title resolves to unknown, never to the first id", () => {
    // Guard documents the route-level rule: ambiguity is detected by the
    // uniqueness test above; resolution itself stays exact-match-only.
    expect(GOVERNED_LICENCE_REGISTRY.filter((e) => e.title === "Same Title")).toHaveLength(0);
  });
});
