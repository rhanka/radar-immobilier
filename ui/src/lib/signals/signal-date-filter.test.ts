import { describe, expect, it } from "vitest";
import type { GraphSignalNode } from "./graph-signal-detail-client.js";
import {
  dateRangeFromSignalTimeRange,
  defaultSignalTimeRange,
  filterNodesByEtapeDate,
  formatSignalTimeRange,
  normalizeSignalTimeRange,
  signalEtapeDate,
} from "./signal-date-filter.js";

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
  it("defaults to the established rolling six-calendar-month lens", () => {
    const now = new Date(2026, 6, 23, 10, 30).getTime();
    const range = defaultSignalTimeRange(now);

    expect(range).toEqual({
      mode: "relative",
      relative: "6mo",
      from: new Date(2026, 0, 23, 10, 30).getTime(),
      to: now,
    });
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

  it("should read an etape date from graph properties", () => {
    const dated = node("dated", { properties: { etape_date: "2026-06-15" } });

    expect(signalEtapeDate(dated)?.toISOString().slice(0, 10)).toBe("2026-06-15");
  });

  it("should retain a date-only signal on the selected day in America/Toronto", () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = "America/Toronto";

    try {
      const dated = node("dated", { etape_date: "2026-06-15" });
      const parsed = signalEtapeDate(dated);
      const visible = filterNodesByEtapeDate([dated], {
        start: new Date(2026, 5, 15),
        end: new Date(2026, 5, 15),
      });

      expect(parsed?.getHours()).toBe(0);
      expect(parsed?.getDate()).toBe(15);
      expect(visible.map(({ id }) => id)).toEqual(["dated"]);
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });

  it("should narrow dated signals while retaining signals with no usable date", () => {
    const visible = filterNodesByEtapeDate(
      [
        node("recent", { etape_date: "2026-07-01" }),
        node("old", { etape_date: "2025-11-01" }),
        node("undated", {}),
      ],
      { start: new Date("2026-06-01"), end: new Date("2026-07-31") },
    );

    expect(visible.map(({ id }) => id)).toEqual(["recent", "undated"]);
  });
});
