import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGraphSignalsByCity } from "./graph-signals-by-city-client.js";

const OK = { ok: true, totalCount: 0, cities: [] };
const WS = "11111111-1111-4111-8111-111111111111";
const SCOPE = { workspaceId: WS };
const BY_CITY = `/api/v1/workspaces/${WS}/signal-facets/by-city`;

function stubFetch(): { calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(OK), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { calls };
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchGraphSignalsByCity — #4 fenêtre date (dateFrom/dateTo)", () => {
  it("sans bornes (Illimité) : aucun query param (all-time, rétro-compatible)", async () => {
    const { calls } = stubFetch();
    await fetchGraphSignalsByCity(SCOPE);
    expect(calls[0]).toBe(BY_CITY);
  });

  it("bornes nulles explicites : toujours aucun param", async () => {
    const { calls } = stubFetch();
    await fetchGraphSignalsByCity(SCOPE, { dateFrom: null, dateTo: null });
    expect(calls[0]).toBe(BY_CITY);
  });

  it("fenêtre active : passe dateFrom + dateTo en query (comptes bulk date-cohérents)", async () => {
    const { calls } = stubFetch();
    await fetchGraphSignalsByCity(SCOPE, { dateFrom: "2026-01-01", dateTo: "2026-08-01" });
    expect(calls[0]).toBe(
      `${BY_CITY}?dateFrom=2026-01-01&dateTo=2026-08-01`,
    );
  });

  it("borne basse seule (ex. 3 derniers mois) : dateFrom seul", async () => {
    const { calls } = stubFetch();
    await fetchGraphSignalsByCity(SCOPE, { dateFrom: "2026-05-01" });
    expect(calls[0]).toBe(`${BY_CITY}?dateFrom=2026-05-01`);
  });

  it("shares the selected clock and exclusions with aggregate counts", async () => {
    const { calls } = stubFetch();
    await fetchGraphSignalsByCity(SCOPE, { dateFrom: "2026-09-29", dateTo: "2026-09-30",
      dateBasis: "scrap", excludePiia: true, excludeDerogations: true });
    const params = new URL(calls[0]!, "http://localhost").searchParams;
    expect(Object.fromEntries(params)).toEqual({ dateFrom: "2026-09-29", dateTo: "2026-09-30",
      dateBasis: "scrap", excludePiia: "1", excludeDerogations: "1" });
  });

  it("forwards the reveal verbatim (showDiscarded=1), default stays hidden", async () => {
    const { calls } = stubFetch();
    await fetchGraphSignalsByCity(SCOPE, { showDiscarded: true });
    expect(calls[0]).toBe(`${BY_CITY}?showDiscarded=1`);
    await fetchGraphSignalsByCity(SCOPE);
    expect(calls[1]).toBe(BY_CITY);
  });

  it("throws a typed error carrying the HTTP status", async () => {
    vi.stubGlobal("fetch", async () => new Response("unavailable", { status: 503 }));
    const failure = await fetchGraphSignalsByCity(SCOPE).catch((err) => err);
    expect(failure?.name).toBe("GraphSignalsHttpError");
    expect(failure?.status).toBe(503);
    expect(String(failure?.message)).toBe("by-city: 503");
  });

  it("carries the server error body code, null when the body is unreadable", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ error: "discarded_signals_unavailable" }), { status: 503 }),
    );
    const outage = await fetchGraphSignalsByCity(SCOPE).catch((err) => err);
    expect(outage?.status).toBe(503);
    expect(outage?.code).toBe("discarded_signals_unavailable");
    vi.stubGlobal("fetch", async () => new Response("unavailable", { status: 503 }));
    const bare = await fetchGraphSignalsByCity(SCOPE).catch((err) => err);
    expect(bare?.status).toBe(503);
    expect(bare?.code).toBeNull();
  });

  it("aborts on an already-aborted signal instead of hanging", async () => {
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    const controller = new AbortController();
    controller.abort();
    const failure = await fetchGraphSignalsByCity(SCOPE, {
      signal: controller.signal,
      timeoutMs: 1000,
    }).catch((err) => err);
    expect(failure?.name).toBe("AbortError");
  });

  it("times out a hanging read instead of blocking controls", async () => {
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const failure = await fetchGraphSignalsByCity(SCOPE, { timeoutMs: 10 }).catch((err) => err);
    expect(failure?.name).toBe("RequestTimeoutError");
  });

  it("times out a stalled body when the headers arrive at once", async () => {
    vi.stubGlobal(
      "fetch",
      async (_url: string, init?: RequestInit) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener(
                "abort",
                () => controller.error(new DOMException("Aborted", "AbortError")),
                { once: true },
              );
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const failure = await fetchGraphSignalsByCity(SCOPE, { timeoutMs: 10 }).catch((err) => err);
    expect(failure?.name).toBe("RequestTimeoutError");
  });
});

describe("fetchGraphSignalsByCity — scoped aggregate (6H)", () => {
  it("reads the scoped by-city route, never the retired legacy aggregate", async () => {
    const { calls } = stubFetch();
    await fetchGraphSignalsByCity(SCOPE, { dateFrom: "2026-01-01", showDiscarded: true });
    expect(calls[0]).toBe(`${BY_CITY}?dateFrom=2026-01-01&showDiscarded=1`);
    expect(calls[0]).not.toContain("/api/graph-signals/");
  });

  it("refuses an empty workspace before any request", async () => {
    const { calls } = stubFetch();
    await expect(fetchGraphSignalsByCity({ workspaceId: "" })).rejects.toThrow("missing_scoped_context");
    expect(calls).toHaveLength(0);
  });
});
