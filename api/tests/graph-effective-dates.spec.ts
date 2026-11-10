import { describe, expect, it } from "vitest";
import { matchesDocumentDateWindow, resultCivilDates } from "@radar/domain";
import { buildNodeRow, mergeNodeRows } from "../src/services/graph/graph-store.js";

const node = (refs: unknown[], properties: Record<string, unknown> = {}) => ({
  id: "sig-1", label: "Avis", type: "Signal", refs: refs as never, properties,
});

describe("materialized effective dates (#872)", () => {
  it("derives document and scrap dates from the same domain function", () => {
    const row = buildNodeRow(node([{ publishedAt: "2026-09-01", fetchedAt: "2026-09-02T03:30:00.000Z" }]) as never, "valleyfield");
    expect(row.documentDates).toEqual(["2026-09-01"]);
    expect(row.scrapDates).toEqual(["2026-09-01"]); // 03:30Z = 23:30 previous day in Toronto
    expect(row.documentDates).toEqual(resultCivilDates(row.props, "document"));
  });
  it("falls back to the stage date and recomputes after merge", () => {
    const a = buildNodeRow(node([], { etape_date: "2026-09-29" }) as never, "valleyfield");
    expect(a.documentDates).toEqual(["2026-09-29"]);
    const merged = mergeNodeRows([a, buildNodeRow(node([{ publishedAt: "2026-10-01" }]) as never, "valleyfield")]);
    expect(merged[0]!.documentDates).toEqual(resultCivilDates(merged[0]!.props, "document"));
  });
  it("SQL-window membership equals the historical JS window on fixtures", () => {
    const cases: Array<{ props: unknown; window: { dateFrom: string; dateTo: string; dateBasis?: "document" | "scrap" } }> = [
      { props: { refs: [{ publishedAt: "2026-09-01" }] }, window: { dateFrom: "2026-09-01", dateTo: "2026-09-01" } },
      { props: { refs: [{ publishedAt: "2026-09-01" }] }, window: { dateFrom: "2026-09-02", dateTo: "2026-09-30" } },
      { props: { properties: { etape_date: "2026-09-15" } }, window: { dateFrom: "2026-09-01", dateTo: "2026-09-30" } },
      { props: { refs: [{ fetchedAt: "2026-09-02T03:30:00.000Z" }] }, window: { dateFrom: "2026-09-01", dateTo: "2026-09-01", dateBasis: "scrap" } },
    ];
    for (const { props, window } of cases) {
      const dates = resultCivilDates(props, window.dateBasis ?? "document");
      const inSqlWindow = dates.some((d) => d >= window.dateFrom && d <= window.dateTo);
      expect(inSqlWindow).toBe(matchesDocumentDateWindow(props, window));
    }
  });
});
