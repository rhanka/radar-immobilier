import { describe, expect, it } from "vitest";
import type { GraphSignalNode } from "./graph-signal-detail-client.js";
import {
  defaultDateRange,
  filterNodesByEtapeDate,
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
  it("should leave the initial temporal lens open", () => {
    const range = defaultDateRange();

    expect(range).toEqual({ start: null, end: null });
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
