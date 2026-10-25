import { describe, expect, it } from "vitest";
import { toDegradedSignalCard } from "../../routes/graph-signals.js";
import { projectSignalCard, publicDocumentUrl } from "./classification-card.js";
import { boundedClassificationJson, PAYLOAD_MAX_BYTES } from "./classification-search.js";
import { classificationFailure } from "./classification-errors.js";
import { SignalFacets } from "./classification-contracts.js";
import { syntheticFacets } from "./classification-test-fixture.js";

describe("bounded classification presentation", () => {
  it("should preserve canonical classification, citations and page while declaring Unicode truncations", () => {
    const canonical = toDegradedSignalCard({ id: "id", type: "Signal", citySlug: "city", sourceRef: null,
      createdAt: new Date("2026-01-01"), label: `A${"🙂".repeat(600)}`, props: {
        description: "d".repeat(9000), properties: { etape: "adoption" }, refs: Array.from({ length: 65 }, (_, i) => ({
          docSha: `${i}`, excerpt: "e".repeat(2500), page: 3, sourceUrl: "https://docs.example.test/pv.pdf",
          documentUrl: "https://docs.example.test/pv.pdf", title: "t".repeat(1100),
        })),
      } });
    const enriched = { ...canonical, docRefs: canonical.docRefs.map((ref) => ({ ...ref, title: "t".repeat(1100) })) };
    const card = projectSignalCard(enriched, "2026-01-01");
    expect(card.stage).toBe(canonical.classification.etape);
    expect(card.automaticExclusionReason).toBe(canonical.classification.exclusion_reason);
    expect(card.label.length).toBeLessThanOrEqual(1024);
    expect(card.label).not.toMatch(/[\uD800-\uDBFF]$/);
    expect(card.description).toHaveLength(8000);
    expect(card.docRefs).toHaveLength(64);
    expect(card.docRefs[0]!.page).toBe(3);
    expect(card.docRefs[0]!.excerpt).toHaveLength(2000);
    expect(card.truncatedFields).toEqual(expect.arrayContaining(["label", "description", "docRefs", "docRefs.title", "docRefs.excerpt"]));
  });
  it("should resolve only the canonical document path on the trusted API origin and discard unsafe URLs", () => {
    const local = "/api/documents/raw?rawRef=raw%2Fcity%2Fpv%20one.pdf";
    expect(publicDocumentUrl(local, "https://api.example.test")).toBe(`https://api.example.test${local}`);
    expect(publicDocumentUrl(local)).toBeNull();
    for (const value of ["/other/path", "/api/documents/raw?url=https://attacker.test", "/api/documents/raw?rawRef=raw%2F..%2Fprivate", "//attacker.test/a", "javascript:alert(1)", "https://user:password@host.test/a", `https://host.test/${"x".repeat(8192)}`]) {
      expect(publicDocumentUrl(value, "https://api.example.test")).toBeNull();
    }
  });
  it("should measure final escaped UTF-8 bytes and offer a bounded restart or terminal refusal", () => {
    const value = { text: "\n".repeat(PAYLOAD_MAX_BYTES / 2) };
    expect(Buffer.byteLength(JSON.stringify(value))).toBeGreaterThan(PAYLOAD_MAX_BYTES);
    try { boundedClassificationJson(value, 20); throw new Error("Expected size refusal"); }
    catch (error) { expect(classificationFailure(error).body.error).toMatchObject({ code: "projection_payload_too_large", action: "reduce_limit", retryable: false, suggestedLimit: 10 }); }
    for (const limit of [1, undefined]) {
      try { boundedClassificationJson(value, limit); throw new Error("Expected size refusal"); }
      catch (error) { expect(classificationFailure(error).body.error).toMatchObject({ code: "projection_payload_too_large", action: "contact_operator", retryable: false }); }
    }
  });
  it("should reject extra head fields, inconsistent hiding and impossible reason associations", () => {
    expect(SignalFacets.safeParse({ ...syntheticFacets(), ownerId: "other" }).success).toBe(false);
    expect(SignalFacets.safeParse({ ...syntheticFacets(), effectiveHidden: true }).success).toBe(false);
    const facets = syntheticFacets(["pertinent"]);
    facets.selection.pertinent!.reason = { profileId: "p", code: "N", verdict: "non_pertinent" };
    expect(SignalFacets.safeParse(facets).success).toBe(false);
  });
});
