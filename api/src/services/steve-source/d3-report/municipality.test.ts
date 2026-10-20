/**
 * Municipality resolution tests with synthetic references only.
 */

import { describe, expect, it } from "vitest";
import {
  normalizeMunicipalityName,
  resolveMunicipality,
} from "./municipality.js";
import { syntheticMunicipalities } from "./fixtures.js";

describe("resolveMunicipality", () => {
  it("matches names with NFC, trim and case ignored", () => {
    const refs = syntheticMunicipalities();
    expect(
      resolveMunicipality("  ville synth a ", null, refs),
    ).toEqual({ kind: "unique", slug: "ville-synth-a" });
    expect(normalizeMunicipalityName("VILLE SYNTH A")).toBe(
      normalizeMunicipalityName("ville synth a"),
    );
  });

  it("resolves a homonym with the MRC column", () => {
    const refs = syntheticMunicipalities();
    expect(
      resolveMunicipality("Bourg Homonyme", "MRC Sud", refs),
    ).toEqual({ kind: "unique", slug: "bourg-homonyme-sud" });
  });

  it("reports a conflict for a homonym without MRC", () => {
    const refs = syntheticMunicipalities();
    expect(resolveMunicipality("Bourg Homonyme", null, refs)).toEqual({
      kind: "conflict",
      slugs: ["bourg-homonyme-nord", "bourg-homonyme-sud"],
    });
  });

  it("leaves an unknown city unresolved", () => {
    expect(
      resolveMunicipality("Ville Inexistante Synth", null, syntheticMunicipalities()),
    ).toEqual({ kind: "unresolved" });
  });

  it("leaves an empty city unresolved", () => {
    expect(resolveMunicipality(null, null, syntheticMunicipalities())).toEqual({
      kind: "unresolved",
    });
    expect(resolveMunicipality("   ", "MRC Nord", syntheticMunicipalities())).toEqual({
      kind: "unresolved",
    });
  });

  it("resolves a public QC name against the default list", () => {
    expect(resolveMunicipality("Westmount", null)).toEqual({
      kind: "unique",
      slug: "westmount",
    });
  });
});
