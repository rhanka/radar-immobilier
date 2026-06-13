import { describe, expect, it } from "vitest";
import {
  OntoRelationType,
  RegulatoryStage,
  ConstraintHit,
} from "./relations.js";

/** Tests for V1 relation types and relational projections (SPEC_ONTOLOGY §1.2, §4.2-4.3). */

describe("OntoRelationType", () => {
  it("lists the 25 v2.0 relation types (renames/valued_by supprimés, 9 ajouts)", () => {
    expect(OntoRelationType.options).toHaveLength(25);
    expect(OntoRelationType.options).toContain("constrains"); // D2
    expect(OntoRelationType.options).toContain("targets_zone"); // intentions (D6)
    // Ajouts v2.0
    expect(OntoRelationType.options).toContain("supports");
    expect(OntoRelationType.options).toContain("references");
    expect(OntoRelationType.options).toContain("concerns");
    expect(OntoRelationType.options).toContain("applies_to");
    expect(OntoRelationType.options).toContain("flags");
    expect(OntoRelationType.options).toContain("has_source");
    expect(OntoRelationType.options).toContain("issued_for");
    expect(OntoRelationType.options).toContain("defines");
    expect(OntoRelationType.options).toContain("subject_of");
    // Suppressions v2.0
    expect(OntoRelationType.options).not.toContain("valued_by");
    expect(OntoRelationType.options).not.toContain("renames");
  });
  it("rejects an unknown relation type", () => {
    expect(() => OntoRelationType.parse("has_stage")).toThrow(); // relational only, non graphify
    expect(() => OntoRelationType.parse("valued_by")).toThrow(); // supprimé v2.0
  });
});

describe("RegulatoryStage (relational projection)", () => {
  it("parses a stage; outcome defaults non-disponible", () => {
    const s = RegulatoryStage.parse({
      id: "11111111-1111-4111-8111-111111111111",
      bylawId: "22222222-2222-4222-8222-222222222222",
      kind: "avis-motion",
      occurredOn: "2026-03-01",
      rawRef: "raw/pv/salaberry/2026/03/01/x.pdf.sha",
    });
    expect(s.outcome).toBe("non-disponible");
  });
  it("rejects an unknown stage kind", () => {
    expect(() =>
      RegulatoryStage.parse({
        id: "11111111-1111-4111-8111-111111111111",
        bylawId: "22222222-2222-4222-8222-222222222222",
        kind: "troisieme-projet",
        occurredOn: "2026-03-01",
        rawRef: "raw/x",
      }),
    ).toThrow();
  });
});

describe("ConstraintHit (auditable risk axis)", () => {
  it("parses a hit carrying ≥1 evidence ref", () => {
    const h = ConstraintHit.parse({
      constraintId: "11111111-1111-4111-8111-111111111111",
      targetKind: "lot",
      targetId: "22222222-2222-4222-8222-222222222222",
      kind: "cptaq-zone-agricole",
      source: "CPTAQ",
      date: "2025-09-01",
      confidence: "high",
      evidenceRefs: ["raw/cptaq/decision-123.pdf.sha#p2"],
    });
    expect(h.evidenceRefs).toHaveLength(1);
  });
  it("REJECTS a hit with no evidence refs (risk axis must be auditable, §7.3)", () => {
    expect(() =>
      ConstraintHit.parse({
        constraintId: "11111111-1111-4111-8111-111111111111",
        targetKind: "zone",
        targetId: "22222222-2222-4222-8222-222222222222",
        kind: "bdzi-inondable",
        source: "BDZI",
        confidence: "medium",
        evidenceRefs: [],
      }),
    ).toThrow();
  });
});
