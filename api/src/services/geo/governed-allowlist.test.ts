/**
 * Unit tests for the zonage property allowlist (I-1A, converged r3 §1, O3).
 *
 * Only recorded fields pass; the default branch drops. `adresse`,
 * `code_postal*`, `extrait_brut` and `url_pdf` never pass, even when the
 * upstream payload carries them and even if a record ever listed them.
 */
import { describe, expect, it } from "vitest";
import {
  applyZonageAllowlist,
  isBannedPropertyKey,
} from "./governed-allowlist.js";

const PILOT = "qc-zonage-gatineau-affectations-territoire";

describe("isBannedPropertyKey (O3 default, fail-closed)", () => {
  it("bans civic-address and raw-excerpt keys", () => {
    expect(isBannedPropertyKey("adresse")).toBe(true);
    expect(isBannedPropertyKey("code_postal")).toBe(true);
    expect(isBannedPropertyKey("code_postal_precision")).toBe(true);
    expect(isBannedPropertyKey("extrait_brut")).toBe(true);
    expect(isBannedPropertyKey("url_pdf")).toBe(true);
  });

  it("does not ban the recorded planning fields", () => {
    for (const key of ["DESCRIPTION", "name", "country", "geoId", "MUNID"]) {
      expect(isBannedPropertyKey(key)).toBe(false);
    }
  });
});

describe("applyZonageAllowlist", () => {
  it("keeps recorded fields and drops unrecorded ones", () => {
    const out = applyZonageAllowlist(PILOT, {
      DESCRIPTION: "Affectation résidentielle",
      name: "Zone R-1",
      unknown_future_field: "dropped",
    });
    expect(out).toEqual({ DESCRIPTION: "Affectation résidentielle", name: "Zone R-1" });
  });

  it("strips adresse, code_postal* and extrait_brut even when upstream sends them", () => {
    const out = applyZonageAllowlist(PILOT, {
      DESCRIPTION: "kept",
      adresse: "123 rue Principale",
      code_postal: "J6T 1A1",
      code_postal_precision: "exact",
      extrait_brut: "M. Tremblay demande une dérogation…",
      url_pdf: "https://example.org/pv.pdf",
      name: "kept-too",
    });
    expect(out).toEqual({ DESCRIPTION: "kept", name: "kept-too" });
    expect(JSON.stringify(out)).not.toContain("rue Principale");
    expect(JSON.stringify(out)).not.toContain("Tremblay");
  });

  it("drops everything for an unrecorded collection", () => {
    expect(
      applyZonageAllowlist("qc-zonage-laval-sad-centre-ville", { DESCRIPTION: "x" }),
    ).toEqual({});
  });

  it("never passes a banned key through, even if a record listed it", () => {
    const out = applyZonageAllowlist(
      PILOT,
      { adresse: "123 rue Principale", DESCRIPTION: "kept" },
      [{ collectionId: PILOT, servedFields: ["adresse", "DESCRIPTION"] }],
    );
    expect(out).toEqual({ DESCRIPTION: "kept" });
  });

  it("leaves provenance envelopes to the dedicated sanitiser (not allowlisted here)", () => {
    const out = applyZonageAllowlist(PILOT, {
      DESCRIPTION: "kept",
      proof: { schema_version: "1.0" },
    });
    expect(out).toEqual({ DESCRIPTION: "kept" });
  });
});
