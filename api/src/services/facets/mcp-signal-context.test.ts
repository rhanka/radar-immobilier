import { describe, expect, it } from "vitest";
import { createDocEnrichmentContext, DOC_ENRICHMENT_BUDGET_MS } from "../../routes/graph-signals.js";

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
});
