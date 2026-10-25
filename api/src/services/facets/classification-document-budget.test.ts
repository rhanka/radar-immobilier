import { describe, expect, it, vi } from "vitest";
import { createDocEnrichmentContext } from "../../routes/graph-signals.js";
import type { ObjectStore } from "../../storage/object-store.js";
import { projectClassificationItem } from "./classification-item.js";
import { syntheticFacets } from "./classification-test-fixture.js";

describe("classification shared canonical document budget", () => {
  it("should bound all items and retries by one cache and deadline", async () => {
    vi.useFakeTimers();
    try {
      const head = vi.fn(() => new Promise<null>(() => {}));
      const store = { head } as unknown as ObjectStore;
      const context = createDocEnrichmentContext(2000);
      const node = { id: "one", type: "Signal", citySlug: "city", label: "Signal", sourceRef: null,
        props: { refs: [{ rawRef: "raw/city/doc.pdf", docSha: "f".repeat(64), excerpt: "Citation", page: 2 }] }, createdAt: new Date("2026-01-01") };
      const row = { node, target: { citySlug: "city", type: "Signal" as const, id: node.id }, day: null, facets: syntheticFacets() };
      const pending = Promise.all([projectClassificationItem(store, row, context, "https://api.example.test"),
        projectClassificationItem(store, { ...row, target: { ...row.target, id: "two" } }, context, "https://api.example.test")]);
      await vi.advanceTimersByTimeAsync(2001);
      expect((await pending).map((item) => item.card.docRefs[0]!.page)).toEqual([2, 2]);
      expect(context.exceeded).toBe(true);
      expect(head).toHaveBeenCalledTimes(1);
      await projectClassificationItem(store, row, context, "https://api.example.test");
      expect(head).toHaveBeenCalledTimes(1);
      expect(context.deadlineAt).toBeLessThan(Date.now());
    } finally { vi.useRealTimers(); }
  });
});
