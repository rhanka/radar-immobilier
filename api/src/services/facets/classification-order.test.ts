import { describe, expect, it } from "vitest";
import { classificationDay, compareSignalRows } from "./classification-order.js";
import { NativeTarget, SignalQuery, decodeQuery } from "./classification-query.js";

describe("classification persisted clock and native identity", () => {
  it("should use persisted document dates and stage fallback without creation time", () => {
    expect(classificationDay({ refs: [{ publishedAt: "2026-02-28" }, { publishedAt: "2026-02-30" }], properties: { etape_date: "2026-03-01" }, createdAt: "2099-01-01" })).toBe("2026-03-01");
    expect(classificationDay({ createdAt: "2099-01-01", fetchedAt: "2099-01-01" })).toBeNull();
    expect(classificationDay({ refs: [{ publishedAt: "2026-02-28" }], properties: { etape_date: "2099-01-01" } })).toBe("2026-02-28");
  });
  it("should put missing dates last and resolve ties by binary native type and ID", () => {
    const row = (id: string, day: string | null, type: "Signal" | "DesignationEvent" = "Signal") => ({ target: { citySlug: "city", type, id }, day });
    const rows = [row("z", null), row("é", "2026-01-01"), row("a", "2026-01-01"), row("x", "2026-01-02"), row("b", "2026-01-01", "DesignationEvent")];
    expect(rows.sort(compareSignalRows).map((entry) => entry.target.id)).toEqual(["x", "b", "a", "é", "z"]);
  });
  it("should preserve native punctuation and UTF-16 limits and reject undelivered filters", () => {
    const target = { citySlug: "city", type: "Signal", id: '\\"\n'.repeat(170) };
    expect(NativeTarget.parse(target)).toEqual(target);
    expect(NativeTarget.safeParse({ ...target, id: "x".repeat(513) }).success).toBe(false);
    for (const query of ["stage=adoption", "query=house", "sort=identity", "dateBasis=scrap", "limit=01", "limit=2&limit=3", "ownerId=x", "cursor="]) {
      expect(() => decodeQuery(new URLSearchParams(`citySlug=city&${query}`), SignalQuery)).toThrow("invalid_query");
    }
    expect(decodeQuery(new URLSearchParams("citySlug=city&limit=100&dateBasis=document&sort=freshness_desc"), SignalQuery).limit).toBe(100);
  });
});
