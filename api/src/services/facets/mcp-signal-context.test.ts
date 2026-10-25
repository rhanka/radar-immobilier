import { describe, expect, it } from "vitest";
import type { ObjectStore } from "../../storage/object-store.js";
import { createDocEnrichmentContext, DOC_ENRICHMENT_BUDGET_MS, toGraphSignalCard } from "../../routes/graph-signals.js";

describe("canonical per-request documentary context", () => {
  it("starts one absolute budget with an empty request-local cache", () => {
    const started = Date.now();
    const first = createDocEnrichmentContext();
    expect(DOC_ENRICHMENT_BUDGET_MS).toBe(2_000);
    expect(first.deadlineAt).toBeGreaterThanOrEqual(started + 2_000);
    expect(first.deadlineAt).toBeLessThanOrEqual(Date.now() + 2_000);
    expect(first.exceeded).toBe(false);
    expect(first.cache.size).toBe(0);
    expect(createDocEnrichmentContext().cache).not.toBe(first.cache);
  });
  it("preserves descriptions, document references and persisted regulatory status", async () => {
    const card = await toGraphSignalCard({ head: async () => null } as unknown as ObjectStore,
      { id: "synthetic", type: "Signal", label: "Label", citySlug: "city", createdAt: null,
        sourceRef: "raw/synthetic/a.pdf", props: { description: "Description",
          properties: { etape: "adoption", regulatoryStatus: "firm" } } }, createDocEnrichmentContext());
    expect(card.description).toBe("Description");
    expect(card.regulatoryStatus).toBe("firm");
    expect(card.docRefs[0]?.rawRef).toBe("raw/synthetic/a.pdf");
    expect(card.etape).toBe("adoption");
  });
});
