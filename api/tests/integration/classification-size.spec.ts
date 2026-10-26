import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/scope-db-fixture.js";
import { classificationFixture } from "./classification-fixture.js";
import { graphNodes } from "../../src/db/schema.js";

describeDb("classification final API response envelope", () => {
  it("should refuse an oversized later page and accept a restarted query without its old cursor", async () => {
    const f = await classificationFixture();
    const refs = Array.from({ length: 64 }, (_, index) => ({ docSha: `${index}`, excerpt: "e".repeat(1900), page: 1,
      sourceUrl: `https://docs.example.test/source/${"s".repeat(7800)}`,
      documentUrl: `https://docs.example.test/document/${"d".repeat(7800)}` }));
    await f.data.db.insert(graphNodes).values([
      { id: "a-small", type: "Signal", citySlug: "synthetic-city", label: "Small" },
      { id: "z-large-1", type: "Signal", citySlug: "synthetic-city", label: "Large 1", props: { refs } },
      { id: "z-large-2", type: "Signal", citySlug: "synthetic-city", label: "Large 2", props: { refs } },
    ]);
    const first = await f.request("signal-facets/search?citySlug=synthetic-city&limit=2");
    expect(first.status).toBe(200);
    const page = await first.json();
    expect(page.items).toHaveLength(2);
    const params = new URLSearchParams({ citySlug: "synthetic-city", limit: "2", cursor: page.page.nextCursor });
    const later = await f.request(`signal-facets/search?${params}`);
    expect(later.status).toBe(503);
    expect(await later.json()).toMatchObject({ ok: false, error: { code: "projection_payload_too_large", action: "reduce_limit", retryable: false, suggestedLimit: 1 } });
    params.set("limit", "1");
    const incompatible = await f.request(`signal-facets/search?${params}`);
    expect(incompatible.status).toBe(400);
    expect((await incompatible.json()).error.code).toBe("incompatible_continuation");
    params.delete("cursor");
    const restarted = await f.request(`signal-facets/search?${params}`);
    expect(restarted.status).toBe(200);
    expect((await restarted.json()).items[0].target.id).toBe(page.items[0].target.id);
  });
});
