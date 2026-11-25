import { describe, expect, it } from "vitest";

import { REFRESH_AVAILABILITY_REASONS } from "../services/graph/refresh-coverage.js";
import { expandRequeueReasons, parseRefreshRequeueArgs } from "./refresh-requeue-abandoned.js";

describe("parseRefreshRequeueArgs", () => {
  it("parses --reason list and expands the availability alias", () => {
    expect(parseRefreshRequeueArgs(["--dry-run", "--reason", "quota,no-route"]).reasons)
      .toEqual(["no-route", "quota"]);
    expect(parseRefreshRequeueArgs(["--dry-run", "--availability-only"]).reasons)
      .toEqual([...REFRESH_AVAILABILITY_REASONS].sort());
    expect(parseRefreshRequeueArgs(["--dry-run", "--reason", "availability,transport"]).reasons)
      .toEqual([...new Set([...REFRESH_AVAILABILITY_REASONS, "transport"])].sort());
  });

  it("refuses combining --restore with --reason or --availability-only", () => {
    expect(() => parseRefreshRequeueArgs(["--restore", "2026-11-25T00-00-00-000Z", "--reason", "quota"]))
      .toThrow("--restore");
    expect(() => parseRefreshRequeueArgs(["--restore", "2026-11-25T00-00-00-000Z", "--availability-only"]))
      .toThrow("--restore");
  });

  it("refuses empty or malformed reason values", () => {
    expect(() => expandRequeueReasons(["Bad Reason!"])).toThrow("invalid reason");
  });
});
