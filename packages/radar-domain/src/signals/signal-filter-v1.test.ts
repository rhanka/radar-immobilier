import { describe, expect, it } from "vitest";
import {
  SIGNAL_QUERY_APP_ROUTE_PATH,
  SIGNAL_QUERY_CONTRACT_VERSION,
  SIGNAL_QUERY_MCP_TOOL,
  SIGNAL_QUERY_PRODUCT_DEFAULT,
  SIGNAL_QUERY_READER_OPERATION,
  SignalFilterV1,
  SignalQueryResponseV1,
} from "./signal-filter-v1.js";

describe("SignalFilterV1 frozen contract", () => {
  it("should accept the named product default", () => {
    const parsed = SignalFilterV1.parse({ ...SIGNAL_QUERY_PRODUCT_DEFAULT });
    expect(parsed.requireZonage).toBe(true);
    expect(parsed.dateBasis).toBe("document");
    expect(parsed.sort).toBe("vivier_rank");
  });

  it("should accept an all-cities opening without citySlug", () => {
    const parsed = SignalFilterV1.parse({});
    expect(parsed.citySlug).toBeUndefined();
    expect(parsed.limit).toBe(50);
    expect(parsed.include).toEqual(["facets"]);
  });

  it("should refuse zoneCode without citySlug", () => {
    const parsed = SignalFilterV1.safeParse({ zoneCode: "H-101" });
    expect(parsed.success).toBe(false);
  });

  it("should refuse an unknown key, a bad civil date, and an out-of-range limit", () => {
    expect(SignalFilterV1.safeParse({ citySlug: "valleyfield", unknown: true }).success).toBe(false);
    expect(SignalFilterV1.safeParse({ dateFrom: "2026-02-31", dateTo: "2026-03-01" }).success).toBe(false);
    expect(SignalFilterV1.safeParse({ dateFrom: "2026-03-02", dateTo: "2026-03-01" }).success).toBe(false);
    expect(SignalFilterV1.safeParse({ limit: 101 }).success).toBe(false);
    expect(SignalFilterV1.safeParse({ q: "x".repeat(129) }).success).toBe(false);
  });

  it("should freeze the single route, operation, and tool spelling", () => {
    expect(SIGNAL_QUERY_APP_ROUTE_PATH).toBe(
      "/api/v1/workspaces/:workspaceId/signal-facets/query",
    );
    expect(SIGNAL_QUERY_READER_OPERATION).toBe("signals.query.v1");
    expect(SIGNAL_QUERY_MCP_TOOL).toBe("query_signals");
    expect(SIGNAL_QUERY_CONTRACT_VERSION).toBe("signal-query-v1");
  });

  it("should require byCity in every response", () => {
    const ok = {
      contractVersion: "signal-query-v1",
      snapshot: { kind: "test" },
      counts: { matched: 1 },
      facets: { basis: "matched-minus-city", byCity: [{ citySlug: "valleyfield", matched: 1 }] },
      items: [],
      page: { limit: 50, nextCursor: null, truncated: false },
    };
    expect(SignalQueryResponseV1.parse(ok).facets.byCity).toHaveLength(1);
    expect(
      SignalQueryResponseV1.safeParse({ ...ok, facets: { basis: "x", byCity: [] }, items: [{}] }).success,
    ).toBe(false);
  });
});
