import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cutoverDisplayMode,
  fetchLotCutoverStatus,
} from "./lot-cutover-client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }),
  );
}

describe("lot cutover status client", () => {
  it.each([
    { maintenanceBarrier: false }, { manifestSha: null }, { manifestSha: "invalid" },
    { activatedAt: null }, { activatedAt: "invalid" }, { activatedAt: undefined },
  ])("should reject inconsistent open status: %j", async (patch) => {
    stubFetch(200, { ok: true, maintenanceBarrier: true, destinationOpen: true,
      manifestSha: "a".repeat(64), activatedAt: "2026-04-01T00:00:00.000Z",
      unavailable: [], pending: [], ...patch });
    await expect(fetchLotCutoverStatus("workspace-1")).rejects.toThrow("unexpected body");
  });

  it("should parse an open destination with explicit unavailable and pending targets", async () => {
    stubFetch(200, {
      ok: true,
      maintenanceBarrier: true,
      destinationOpen: true,
      manifestSha: "a".repeat(64),
      activatedAt: "2026-04-01T00:00:00.000Z",
      unavailable: ["dest:city::lot-1::real"],
      pending: [{ targetKey: "dest:city::lot-2::real", cause: "d5-keep-pending" }],
    });
    const status = await fetchLotCutoverStatus("workspace-1");
    expect(status).toEqual({
      maintenanceBarrier: true,
      destinationOpen: true,
      manifestSha: "a".repeat(64),
      activatedAt: "2026-04-01T00:00:00.000Z",
      unavailable: ["dest:city::lot-1::real"],
      pending: [{ targetKey: "dest:city::lot-2::real", cause: "d5-keep-pending" }],
    });
    expect(cutoverDisplayMode(status)).toBe("facets");
  });

  it("should stay on legacy panels for closed gates, failures, and malformed bodies", async () => {
    stubFetch(200, {
      ok: true,
      maintenanceBarrier: false,
      destinationOpen: false,
      manifestSha: null,
      activatedAt: null,
      unavailable: [],
      pending: [],
    });
    expect(cutoverDisplayMode(await fetchLotCutoverStatus("workspace-1"))).toBe("legacy");
    stubFetch(503, { error: "lot_cutover_barrier" });
    await expect(fetchLotCutoverStatus("workspace-1")).rejects.toThrow("HTTP 503");
    expect(cutoverDisplayMode(null)).toBe("unavailable");
    stubFetch(200, { ok: true, destinationOpen: true });
    await expect(fetchLotCutoverStatus("workspace-1")).rejects.toThrow("unexpected body");
  });
});
