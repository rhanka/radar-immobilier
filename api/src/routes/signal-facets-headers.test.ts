import { describe, expect, it, vi } from "vitest";
import type { Database } from "../db/client.js";
import type { ObjectStore } from "../storage/object-store.js";
import { graphSignalsRoute } from "./graph-signals.js";
import { signalFacetsRoute } from "./signal-facets.js";
import { createApp } from "../app.js";
import { loadConfig, resolveAuthConfig } from "../config.js";
import { createDiscardedSignalsReader } from "../services/facets/discarded-reader.js";

vi.mock("../services/graph/graph-store.js", async (original) => ({
  ...await original<typeof import("../services/graph/graph-store.js")>(),
  getSignalNodesForCity: vi.fn(), listCitiesWithSignalNodes: vi.fn(),
}));
import { getSignalNodesForCity, listCitiesWithSignalNodes } from "../services/graph/graph-store.js";
const db = {} as Database;
const store = {} as ObjectStore;
function privateHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Cookie, Authorization");
}
describe("personal signal response headers", () => {
  it("should protect successful, missing and failed graph reads", async () => {
    const app = graphSignalsRoute({ db, store });
    vi.mocked(listCitiesWithSignalNodes).mockResolvedValue([]);
    const aggregate = await app.request("/api/graph-signals/by-city");
    expect(aggregate.status).toBe(200);
    privateHeaders(aggregate);
    vi.mocked(getSignalNodesForCity).mockResolvedValue([]);
    const missing = await app.request("/api/graph-signals/missing");
    expect(missing.status).toBe(404);
    privateHeaders(missing);
    const failing = graphSignalsRoute({ db, store, discarded: { forViewer: async () => { throw new Error("synthetic reader failure"); } } });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const failed = await failing.request("/api/graph-signals/by-city");
      expect(failed.status).toBe(503);
      expect(await failed.json()).toEqual({ ok: false, error: "discarded_signals_unavailable" });
      privateHeaders(failed);
    } finally { log.mockRestore(); }
  });
  it("should protect facet errors in open mode", async () => {
    const response = await signalFacetsRoute({ db }).request("/api/v1/signal-facets/reason-codes");
    expect(response.status).toBe(401);
    privateHeaders(response);
  });
  it("should protect refusals from the outer authentication middleware", async () => {
    const app = createApp({ db, store, auth: { ...resolveAuthConfig(loadConfig({})), enabled: true },
      checkDb: async () => ({ ok: true }), checkObjectStore: async () => ({ ok: true }) });
    for (const path of ["/api/graph-signals/by-city", "/api/v1/signal-facets/reason-codes"]) {
      const response = await app.request(path);
      expect(response.status).toBe(401);
      privateHeaders(response);
    }
  });
  it("should propagate storage errors from the persistent discard adapter", async () => {
    const failure = new Error("synthetic storage failure");
    const reader = createDiscardedSignalsReader({ select: () => { throw failure; } } as unknown as Database);
    await expect(reader.forViewer("synthetic-sub")).rejects.toBe(failure);
  });
});
