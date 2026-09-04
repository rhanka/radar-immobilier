// Unit tests for the graph-candidate pre-flight predictor.
//
// `predictProjectionAbort` must be a FAITHFUL, read-only mirror of the two gates
// `upsertGraphAtomic` applies (business-property regression + completeness
// regression), so a cohort operator can predict — WITHOUT writing PG — whether a
// grounded candidate would abort. Drift is prevented structurally: the predictor
// reuses the SAME exported guard functions (`findMissingBusinessProperties`,
// `countCompleteSignals`, `buildNodeRow`, `mergeNodeRows`). These tests pin the
// WIRING (both gates fire, reasons surface, intendedRemovals passes through) —
// the guard functions themselves are covered by graph-store.test.ts.
import { describe, it, expect } from "vitest";
import { predictProjectionAbort } from "./graph-candidate-check.js";

describe("predictProjectionAbort — business-property gate (gate 1)", () => {
  it("no abort when the candidate CARRIES the existing business-property (the fixed §7 pilot)", () => {
    const before = [
      { id: "des:1", type: "DesignationEvent", props: { properties: { reglement_number: "943-01" } } },
    ];
    const candidate = {
      nodes: [{ id: "des:1", type: "DesignationEvent", properties: { reglement_number: "943-01" } }],
    };
    const r = predictProjectionAbort("sainte-martine", before, candidate);
    expect(r.wouldAbort).toBe(false);
    expect(r.propertyRegressions).toEqual([]);
    expect(r.completenessRegression).toBe(false);
    expect(r.candidateNodeCount).toBe(1);
  });

  it("predicts abort when the candidate DROPS reglement_number on an existing node (the original pilot failure)", () => {
    const before = [
      { id: "des:1", type: "DesignationEvent", props: { properties: { reglement_number: "943-01" } } },
    ];
    const candidate = {
      // citation-focused candidate that lost the business-property
      nodes: [{ id: "des:1", type: "DesignationEvent", properties: { effet_densifiant: "fort" } }],
    };
    const r = predictProjectionAbort("sainte-martine", before, candidate);
    expect(r.wouldAbort).toBe(true);
    expect(r.propertyRegressions).toEqual([
      { citySlug: "sainte-martine", nodeId: "des:1", missingKeys: ["reglement_number"] },
    ]);
    expect(r.reasons.some((m) => m.includes("business-property") && m.includes("des:1"))).toBe(true);
  });

  it("exempts an intentionally-removed node (intendedRemovals passthrough)", () => {
    const before = [
      { id: "bylaw:x", type: "Bylaw", props: { properties: { reglement_number: "326-2026" } } },
    ];
    const candidate = { nodes: [] as unknown[] };
    // Without the exemption → predicted abort.
    expect(predictProjectionAbort("x", before, candidate).wouldAbort).toBe(true);
    // With the node in intendedRemovals → clean (removal is intended, not a regression).
    const r = predictProjectionAbort("x", before, candidate, new Set(["bylaw:x"]));
    expect(r.wouldAbort).toBe(false);
    expect(r.propertyRegressions).toEqual([]);
  });
});

describe("predictProjectionAbort — completeness gate (gate 2)", () => {
  it("predicts abort when a previously-complete signal loses its evidence (citation+rawRef)", () => {
    const before = [
      { id: "sig:1", type: "Signal", props: { refs: [{ excerpt: "ADOPTION 943", rawRef: "a.pdf" }] } },
    ];
    const candidate = {
      // same node, but the rawRef (hard proof) is gone → no longer a complete signal
      nodes: [{ id: "sig:1", type: "Signal", refs: [{ excerpt: "ADOPTION 943" }] }],
    };
    const r = predictProjectionAbort("townx", before, candidate);
    expect(r.completeBefore).toBe(1);
    expect(r.completeAfter).toBe(0);
    expect(r.completenessRegression).toBe(true);
    expect(r.wouldAbort).toBe(true);
    expect(r.reasons.some((m) => m.includes("1") && m.includes("0"))).toBe(true);
  });

  it("no abort when the candidate PRESERVES the complete signal", () => {
    const before = [
      { id: "sig:1", type: "Signal", props: { refs: [{ excerpt: "ADOPTION 943", rawRef: "a.pdf" }] } },
    ];
    const candidate = {
      nodes: [{ id: "sig:1", type: "Signal", refs: [{ excerpt: "ADOPTION 943", rawRef: "a.pdf" }] }],
    };
    const r = predictProjectionAbort("townx", before, candidate);
    expect(r.completeBefore).toBe(1);
    expect(r.completeAfter).toBe(1);
    expect(r.wouldAbort).toBe(false);
  });
});

describe("predictProjectionAbort — clean when both gates pass", () => {
  it("reports wouldAbort=false with empty reasons for a complete enriching candidate", () => {
    const before = [
      { id: "des:1", type: "DesignationEvent", props: { properties: { reglement_number: "943-01" } } },
      { id: "sig:1", type: "Signal", props: { refs: [{ excerpt: "x", rawRef: "a.pdf" }] } },
    ];
    const candidate = {
      nodes: [
        // carries reglement_number AND enriches with a citation
        {
          id: "des:1",
          type: "DesignationEvent",
          properties: { reglement_number: "943-01" },
          refs: [{ excerpt: "cited", rawRef: "b.pdf" }],
        },
        { id: "sig:1", type: "Signal", refs: [{ excerpt: "x", rawRef: "a.pdf" }] },
      ],
    };
    const r = predictProjectionAbort("sainte-martine", before, candidate);
    expect(r.wouldAbort).toBe(false);
    expect(r.reasons).toEqual([]);
  });
});

describe("predictProjectionAbort — real §7 pilot shape (extraction matrix, candidate c4065c46)", () => {
  // Ground truth from extraction's pilot diag on Ste-Martine: PG carries
  // reglement_number on 32 nodes = 16 DesignationEvent + 16 Signal (both
  // modification_zonage), populated by a later zonage projection. The STALE
  // candidate (June cache) carried it on 0/32, so projecting it would drop
  // reglement_number on all 32 → the business-property-regression guard aborted
  // the city (ok:0 / aborted:1). Matched by node id.
  const N = 16;
  const nodes = [
    ...Array.from({ length: N }, (_, i) => ({ id: `event-ste-martine-zonage-${i}`, type: "DesignationEvent" })),
    ...Array.from({ length: N }, (_, i) => ({ id: `signal-rezonage-ste-martine-${i}`, type: "Signal" })),
  ];
  // PG "before": 32/32 carry reglement_number (+ etape, per the matrix).
  const before = nodes.map((n) => ({
    id: n.id,
    type: n.type,
    props: { properties: { reglement_number: `R-${n.id}`, etape: "adoption" } },
  }));

  it("predicts abort for the STALE candidate that drops reglement_number on all 32 nodes", () => {
    const staleCandidate = {
      nodes: nodes.map((n) => ({ id: n.id, type: n.type, properties: { etape: "adoption" } })),
    };
    const r = predictProjectionAbort("sainte-martine", before, staleCandidate);
    expect(r.wouldAbort).toBe(true);
    expect(r.propertyRegressions).toHaveLength(2 * N); // 32
    expect(r.propertyRegressions.every((reg) => reg.missingKeys.includes("reglement_number"))).toBe(true);
  });

  it("is clean for the RE-GROUNDED candidate that carries reglement_number (the fix) + adds citations", () => {
    const freshCandidate = {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type,
        properties: { reglement_number: `R-${n.id}`, etape: "adoption" },
        // grounding enrichment (citation) must NOT regress business-props
        refs: [{ excerpt: "ADOPTION R-943", rawRef: `${n.id}.pdf` }],
      })),
    };
    const r = predictProjectionAbort("sainte-martine", before, freshCandidate);
    expect(r.wouldAbort).toBe(false);
    expect(r.propertyRegressions).toEqual([]);
  });

  it("checks the guarded set GENERICALLY, not hardcoded Ste-Martine (effet_densifiant is 0 here but present on other cohort cities)", () => {
    // The predictor inherits the guard's coverage of EVERY props.properties key,
    // so a business-prop absent at Ste-Martine still aborts where it exists.
    const beforeOther = [
      { id: "sig:densif", type: "Signal", props: { properties: { effet_densifiant: "fort" } } },
    ];
    const candidateOther = { nodes: [{ id: "sig:densif", type: "Signal", properties: {} }] };
    const r = predictProjectionAbort("other-city", beforeOther, candidateOther);
    expect(r.wouldAbort).toBe(true);
    expect(r.propertyRegressions).toEqual([
      { citySlug: "other-city", nodeId: "sig:densif", missingKeys: ["effet_densifiant"] },
    ]);
  });
});

describe("predictProjectionAbort — source-ref provenance gate (gate3, upgrade)", () => {
  it("predicts abort when the candidate would DROP a node's source docSha (the PV-ref loss)", () => {
    const before = [{ id: "sig:1", type: "Signal", props: { refs: [{ docSha: "SHA_PV" }] } }];
    const candidate = { nodes: [{ id: "sig:1", type: "Signal", refs: [] as unknown[] }] };
    const r = predictProjectionAbort("ste-martine", before, candidate);
    expect(r.wouldAbort).toBe(true);
    expect(r.sourceRefRegressions).toEqual([
      { citySlug: "ste-martine", nodeId: "sig:1", missingDocShas: ["SHA_PV"] },
    ]);
    expect(r.reasons.some((m) => m.includes("source-ref provenance") && m.includes("SHA_PV"))).toBe(true);
  });

  it("no abort when the candidate PRESERVES the source docSha (additions allowed)", () => {
    const before = [{ id: "sig:1", type: "Signal", props: { refs: [{ docSha: "SHA_PV" }] } }];
    const candidate = {
      nodes: [{ id: "sig:1", type: "Signal", refs: [{ docSha: "SHA_PV" }, { docSha: "SHA_GROUNDING", excerpt: "cited" }] }],
    };
    const r = predictProjectionAbort("x", before, candidate);
    expect(r.wouldAbort).toBe(false);
    expect(r.sourceRefRegressions).toEqual([]);
  });
});
