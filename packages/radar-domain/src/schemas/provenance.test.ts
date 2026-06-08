import { describe, expect, it } from "vitest";
import { OntologyStatus, ReconBridge } from "./provenance.js";

/** Tests for the canonical bridge + reconciliation status (SPEC_ONTOLOGY §1.3, §4.1). */

describe("OntologyStatus", () => {
  it("enumerates the graphify hardening statuses", () => {
    expect(OntologyStatus.options).toEqual([
      "candidate",
      "attached",
      "needs_review",
      "validated",
      "rejected",
      "superseded",
    ]);
  });
});

describe("ReconBridge", () => {
  it("defaults reconStatus to validated and knownTo to null", () => {
    const b = ReconBridge.parse({
      canonicalId: "zone::salaberry::2026::H-609-4",
      knownFrom: "2026-06-07T10:00:00.000Z",
    });
    expect(b.reconStatus).toBe("validated");
    expect(b.reconPatchId).toBeNull();
    expect(b.knownTo).toBeNull();
  });
  it("rejects an empty canonicalId", () => {
    expect(() =>
      ReconBridge.parse({ canonicalId: "", knownFrom: "2026-06-07T10:00:00.000Z" }),
    ).toThrow();
  });
  it("rejects a knownFrom that is not a datetime", () => {
    expect(() =>
      ReconBridge.parse({ canonicalId: "x", knownFrom: "2026-06-07" }),
    ).toThrow();
  });
});
