import { describe, expect, it, vi } from "vitest";
import { HttpDataSource } from "./data-source.js";
import { SIGNAL_SEARCH_PATH } from "./signal-search-response.js";
import { signalSearchBody, signalSearchItem, SIGNAL_TEST_WORKSPACE } from "./signal-search-test-fixture.js";

describe("scoped signal HTTP adapter", () => {
  const baseUrl = "https://api.test.local";
  it.each([undefined, false, true])("forwards filters and reveal=%s exactly once under the exchanged token", async (showDiscarded) => {
    const signal = signalSearchItem("mont-tremblant");
    const fetchImpl = vi.fn(async () => Response.json(signalSearchBody("mont-tremblant", [signal])));
    const data = new HttpDataSource({ baseUrl, fetchImpl });
    expect(await data.searchSignals({ city: "Mont-Tremblant", limit: 1, etape: "avis motion",
      query: "zone & lot", showDiscarded, workspaceId: SIGNAL_TEST_WORKSPACE }, { accessToken: "exchanged" })).toEqual([signal]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [input, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const url = new URL(input);
    expect(url.pathname).toBe(SIGNAL_SEARCH_PATH);
    expect(Object.fromEntries(url.searchParams)).toEqual({ city: "mont-tremblant", limit: "1",
      etape: "avis motion", query: "zone & lot", workspaceId: SIGNAL_TEST_WORKSPACE,
      ...(showDiscarded === undefined ? {} : { showDiscarded: showDiscarded ? "1" : "0" }) });
    expect(init).toMatchObject({ method: "GET", redirect: "error", headers: { authorization: "Bearer exchanged" } });
  });
  it.each([
    {}, { ok: true, citySlug: "longueuil", nodes: [] },
    { ...signalSearchBody(), citySlug: "other" }, { ...signalSearchBody(), workspaceId: "default" },
    { ...signalSearchBody(), extra: "private" }, signalSearchBody("longueuil", [{}]),
    signalSearchBody("longueuil", [signalSearchItem("other")]),
    signalSearchBody("longueuil", [signalSearchItem(), signalSearchItem()]),
    signalSearchBody("longueuil", [signalSearchItem("longueuil", { regulatoryStatus: undefined })]),
    signalSearchBody("longueuil", [signalSearchItem("longueuil", { extra: "private" })]),
  ])("refuses an invalid envelope without fallback: %j", async (body) => {
    const fetchImpl = vi.fn(async () => Response.json(body));
    const data = new HttpDataSource({ baseUrl, fetchImpl });
    await expect(data.searchSignals({ city: "longueuil", limit: 1 })).rejects.toMatchObject({ code: "radar_api_bad_payload" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each([
    [503, "legacy_cutover_closed", "signal_cutover_in_progress"],
    [410, "legacy_retired", "signal_route_retired"],
    [404, "no_signal_nodes", "signal_endpoint_unavailable"],
    [403, "delegated_scope_refused", "delegated_scope_refused"],
  ])("keeps HTTP %s an error with no retry", async (status, error, code) => {
    const fetchImpl = vi.fn(async () => Response.json({ error }, { status: Number(status) }));
    await expect(new HttpDataSource({ baseUrl, fetchImpl }).searchSignals({ city: "longueuil", limit: 1 }))
      .rejects.toMatchObject({ code, upstreamStatus: status });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("allows only an explicit valid 200 empty collection and rejects malformed JSON", async () => {
    const fetchImpl = vi.fn(async () => Response.json(signalSearchBody()));
    const data = new HttpDataSource({ baseUrl, fetchImpl });
    expect(await data.searchSignals({ city: "longueuil", limit: 1 })).toEqual([]);
    fetchImpl.mockImplementation(async () => new Response("secret"));
    await expect(data.searchSignals({ city: "longueuil", limit: 1 })).rejects.toMatchObject({ code: "radar_api_bad_payload" });
    fetchImpl.mockRejectedValue(new Error("https://internal/token=secret"));
    await expect(data.searchSignals({ city: "longueuil", limit: 1 })).rejects.toMatchObject({ code: "radar_api_unreachable" });
  });
  it("rejects a response from a different explicit workspace", async () => {
    const data = new HttpDataSource({ baseUrl, fetchImpl: async () => Response.json(signalSearchBody()) });
    await expect(data.searchSignals({ city: "longueuil", limit: 1, workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }))
      .rejects.toMatchObject({ code: "radar_api_bad_payload" });
  });
});
