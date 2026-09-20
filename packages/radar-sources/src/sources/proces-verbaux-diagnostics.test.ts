import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DRUMMONDVILLE_PV_CONFIG,
  ProcesVerbauxGenericAdapter,
  PvSourceFetchError,
  PV_USER_AGENT,
  type PvFetchLike,
} from "./proces-verbaux-generic.js";

const url = DRUMMONDVILLE_PV_CONFIG.pvIndexUrl;
const ref = {
  url: "https://example.org/pv.pdf", sourceKind: "pv" as const,
  discoveredAt: "2026-06-10T00:00:00Z",
};
const headers = {
  server: "cloudflare", "cf-ray": "test-ray", "cf-mitigated": "challenge",
  location: "/missing", "content-type": "text/html",
};
const response = (status: number) => ({
  ok: status === 200, status,
  headers: new Headers({ ...headers, authorization: "AUTH_SECRET", "set-cookie": "COOKIE_SECRET" }),
  arrayBuffer: vi.fn(async () => new TextEncoder().encode("BODY_SECRET").buffer),
});
afterEach(() => vi.restoreAllMocks());

describe("PV request diagnostics", () => {
  it.each(["index", "document"] as const)("should log and propagate an HTTP error during %s", async (phase) => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const res = response(404);
    let time = 0;
    const adapter = new ProcesVerbauxGenericAdapter(DRUMMONDVILLE_PV_CONFIG, {
      fetchImpl: async () => { time += 42; return res; },
      now: () => new Date(time),
    });
    const operation = phase === "index" ? adapter.list({})[Symbol.asyncIterator]().next() : adapter.fetch(ref);
    const error = await operation.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PvSourceFetchError);
    const diagnostic = { url: phase === "index" ? url : ref.url, phase, httpStatus: 404, durationMs: 42, headers };
    expect(error).toMatchObject({ kind: "http", ...diagnostic });
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(log.mock.calls[0]![0] as string)).toEqual({
      event: "pv-fetch", city: "drummondville", ...diagnostic,
    });
    expect(res.arrayBuffer).not.toHaveBeenCalled();
    expect(JSON.stringify([error, log.mock.calls])).not.toMatch(/AUTH_SECRET|COOKIE_SECRET|BODY_SECRET|authorization|set-cookie/);
  });

  it("should report successful requests through the injected logger", async () => {
    const onRequest = vi.fn();
    const adapter = new ProcesVerbauxGenericAdapter(DRUMMONDVILLE_PV_CONFIG, {
      fetchImpl: async () => response(200), onRequest,
    });
    await adapter.fetch(ref);
    expect(onRequest).toHaveBeenCalledExactlyOnceWith({
      url: ref.url, phase: "document", httpStatus: 200,
      durationMs: expect.any(Number), headers,
    });
  });

  it.each(["Error", "AbortError"])("should report %s without leaking transport details", async (name) => {
    const onRequest = vi.fn();
    const adapter = new ProcesVerbauxGenericAdapter(DRUMMONDVILLE_PV_CONFIG, {
      fetchImpl: async () => { throw Object.assign(new Error("AUTH_SECRET"), { name }); }, onRequest,
    });
    const error = await adapter.list({})[Symbol.asyncIterator]().next().catch((e: unknown) => e);
    expect(error).toMatchObject({
      kind: name === "AbortError" ? "timeout" : "network", phase: "index", url, httpStatus: null, headers: {},
    });
    expect(onRequest).toHaveBeenCalledOnce();
    expect(JSON.stringify([error, onRequest.mock.calls])).not.toContain("AUTH_SECRET");
  });

  // The header-negotiation experiment of PR #730 is gone: the cause of the 404
  // was a dead document link, not a header, and both variants answered
  // identically from the workstation, from a preproduction pod and from a
  // residential IP (INVESTIGATION_404_STATUS §5). What must NOT regress is the
  // identifiable agent — a scrape that hides who it is would be a different
  // decision from the one the owner took.
  it("should always send the identifiable agent and the plain accept header", async () => {
    const fetchImpl = vi.fn<PvFetchLike>(async () => response(200));
    const adapter = new ProcesVerbauxGenericAdapter(DRUMMONDVILLE_PV_CONFIG, {
      fetchImpl, onRequest: () => {},
    });
    await adapter.list({})[Symbol.asyncIterator]().next();
    const sent = fetchImpl.mock.calls[0]![1]!.headers;
    expect(sent).toEqual({ "user-agent": PV_USER_AGENT, accept: "text/html" });
  });
});
