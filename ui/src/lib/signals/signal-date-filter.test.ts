import { describe, expect, it } from "vitest";
import type { GraphSignalNode } from "./graph-signal-detail-client.js";
import {
  dateBasisForTimeRange,
  dateRangeFromSignalTimeRange,
  defaultSignalTimeRange,
  filterNodesByDocumentDate,
  formatSignalTimeRange,
  normalizeSignalTimeRange,
  signalDocumentDateWindow,
  SIGNAL_TIME_RANGE_PRESETS,
} from "./signal-date-filter.js";
import { matchesDocumentDateWindow } from "@radar/domain";

function node(id: string, props: Record<string, unknown>): GraphSignalNode {
  return {
    id,
    type: "Signal",
    label: id,
    citySlug: "austin",
    sourceRef: null,
    createdAt: null,
    props,
  };
}

describe("signal date filter", () => {
  it("offers last week and last month before the existing month presets, in order", () => {
    expect(SIGNAL_TIME_RANGE_PRESETS.map(({ token, label }) => [token, label])).toEqual([
      ["7d", "Dernière semaine"],
      ["1mo", "Dernier mois"],
      ["3mo", "3 derniers mois"],
      ["6mo", "6 derniers mois"],
      ["12mo", "12 derniers mois"],
      ["all", "Illimité"],
    ]);
  });

  it("defaults to the rolling last-week lens (seven calendar days)", () => {
    const now = new Date(2026, 9, 9, 10, 30).getTime();
    const range = defaultSignalTimeRange(now);

    expect(range).toEqual({
      mode: "relative",
      relative: "7d",
      from: new Date(2026, 9, 2, 10, 30).getTime(),
      to: now,
    });
    expect(formatSignalTimeRange(range, "fr-CA")).toBe("Dernière semaine");
    expect(dateRangeFromSignalTimeRange(range)).toEqual({ start: new Date(2026, 9, 2), end: new Date(2026, 9, 9) });
  });

  it("resolves last week across a month boundary and last month as one calendar month", () => {
    const at = new Date(2026, 2, 3, 8, 0).getTime();
    expect(normalizeSignalTimeRange({ mode: "relative", relative: "7d", from: 0, to: 0 }, at))
      .toEqual({ mode: "relative", relative: "7d", from: new Date(2026, 1, 24, 8, 0).getTime(), to: at });
    expect(normalizeSignalTimeRange({ mode: "relative", relative: "1mo", from: 0, to: 0 }, at))
      .toEqual({ mode: "relative", relative: "1mo", from: new Date(2026, 1, 3, 8, 0).getTime(), to: at });
    // Month-end clamp, same rule as the existing month presets.
    const endOfMarch = new Date(2026, 2, 31, 9, 0).getTime();
    expect(normalizeSignalTimeRange({ mode: "relative", relative: "1mo", from: 0, to: 0 }, endOfMarch).from)
      .toBe(new Date(2026, 1, 28, 9, 0).getTime());
    expect(formatSignalTimeRange({ mode: "relative", relative: "1mo", from: 0, to: 0 }, "fr-CA")).toBe("Dernier mois");
  });

  it("applies the same last-week window on the client panel and through the API window function", () => {
    const now = new Date(2026, 9, 9, 10, 30).getTime();
    const range = dateRangeFromSignalTimeRange(defaultSignalTimeRange(now));
    const nodes = [
      node("today", { refs: [{ publishedAt: "2026-10-09" }] }),
      node("first-day", { refs: [{ publishedAt: "2026-10-02" }] }),
      node("eight-days", { refs: [{ publishedAt: "2026-10-01" }] }),
      node("stage-only", { properties: { etape_date: "2026-10-05" } }),
      node("undated", {}),
    ];
    const panel = filterNodesByDocumentDate(nodes, range).map(({ id }) => id);
    // Window sent to /api/graph-signals/by-city (rail + map counts), filtered by the API function.
    const window = signalDocumentDateWindow(range);
    expect(window).toEqual({ dateBasis: "document", dateFrom: "2026-10-02", dateTo: "2026-10-09" });
    const api = nodes.filter((n) => matchesDocumentDateWindow(n.props, window)).map(({ id }) => id);
    expect(panel).toEqual(["today", "first-day", "stage-only"]);
    expect(api).toEqual(panel);
  });

  it("« Illimité » (token all) : bornes nulles → tous les signaux, même sans date", () => {
    const range = {
      mode: "relative" as const,
      relative: "all",
      from: 0,
      to: new Date(2026, 6, 1).getTime(),
    };
    const dateRange = dateRangeFromSignalTimeRange(range);
    expect(dateRange).toEqual({ start: null, end: null });

    const nodes = [
      node("ancien", { etapeDate: "1990-01-01" }),
      node("recent", { etapeDate: "2026-06-01" }),
      node("sans-date", {}),
    ];
    expect(filterNodesByDocumentDate(nodes, dateRange).map((n) => n.id)).toEqual([
      "ancien",
      "recent",
      "sans-date",
    ]);
    // Libellé DS produit bien « Illimité ».
    expect(formatSignalTimeRange(range, "fr-CA")).toBe("Illimité");
  });

  it("anchors a selected DS month preset to the selection instant", () => {
    const staleTo = new Date(2026, 7, 31, 12, 0).getTime();
    const selectedAt = new Date(2026, 8, 1, 9, 15).getTime();
    const normalized = normalizeSignalTimeRange({
      mode: "relative",
      relative: "6mo",
      from: staleTo - 180 * 24 * 60 * 60 * 1_000,
      to: staleTo,
    }, selectedAt);

    expect(normalized).toEqual({
      mode: "relative",
      relative: "6mo",
      from: new Date(2026, 2, 1, 9, 15).getTime(),
      to: selectedAt,
    });
  });

  it("adapts the DS epoch range to local civil dates", () => {
    const range = dateRangeFromSignalTimeRange({
      mode: "absolute",
      from: new Date(2026, 5, 15, 14, 30).getTime(),
      to: new Date(2026, 5, 16, 9, 15).getTime(),
    });

    expect(range).toEqual({
      start: new Date(2026, 5, 15),
      end: new Date(2026, 5, 16),
    });
  });

  it("formats a custom range as compact local dates without times", () => {
    const formatted = formatSignalTimeRange({
      mode: "absolute",
      from: new Date(2025, 6, 17, 8, 37).getTime(),
      to: new Date(2025, 7, 28, 18, 5).getTime(),
    }, "fr-CA");

    expect(formatted).toBe("2025-07-17 – 2025-08-28");
  });

  it("should use persisted documentary refs rather than an event date", () => {
    const dated = node("dated", { refs: [{ publishedAt: "2026-06-15" }], properties: { etape_date: "2025-01-01" } });
    expect(filterNodesByDocumentDate([dated], { start: new Date(2026, 5, 15), end: new Date(2026, 5, 15) }))
      .toEqual([dated]);
  });

  it("should retain a date-only signal on the selected day in America/Toronto", () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = "America/Toronto";

    try {
      const dated = node("dated", { refs: [{ publishedAt: "2026-06-15" }] });
      const visible = filterNodesByDocumentDate([dated], {
        start: new Date(2026, 5, 15),
        end: new Date(2026, 5, 15),
      });

      expect(visible.map(({ id }) => id)).toEqual(["dated"]);
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });

  it("should exclude undated results from a bounded document period", () => {
    const visible = filterNodesByDocumentDate(
      [
        node("recent", { refs: [{ publishedAt: "2026-07-01" }] }),
        node("old", { refs: [{ publishedAt: "2025-11-01" }] }),
        node("undated", {}),
      ],
      { start: new Date(2026, 5, 1), end: new Date(2026, 6, 31) },
    );

    expect(visible.map(({ id }) => id)).toEqual(["recent"]);
  });

  it("should change only the document clock when scrape mode is selected", () => {
    const old = node("old", { refs: [{ publishedAt: "2025-11-01", fetchedAt: "2026-07-01T12:00:00Z" }] });
    const period = { start: new Date(2026, 5, 1), end: new Date(2026, 6, 31) };
    expect(filterNodesByDocumentDate([old], period)).toEqual([]);
    expect(filterNodesByDocumentDate([old], period, "scrap")).toEqual([old]);
  });
});

describe("dateBasisForTimeRange", () => {
  it("keeps the acquisition basis only for a custom period", () => {
    expect(dateBasisForTimeRange({ mode: "absolute", from: 1, to: 2 }, "scrap")).toBe("scrap");
    expect(dateBasisForTimeRange({ mode: "absolute", from: 1, to: 2 }, "document")).toBe("document");
    for (const relative of ["7d", "1mo", "3mo", "6mo", "12mo", "all"]) {
      expect(dateBasisForTimeRange({ mode: "relative", relative, from: 0, to: 0 }, "scrap")).toBe("document");
    }
  });
});
