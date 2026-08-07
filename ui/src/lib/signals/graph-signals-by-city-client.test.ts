import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGraphSignalsByCity } from "./graph-signals-by-city-client.js";

const OK = { ok: true, totalCount: 0, cities: [] };

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
    await fetchGraphSignalsByCity("");
    expect(calls[0]).toBe("/api/graph-signals/by-city");
  });

  it("bornes nulles explicites : toujours aucun param", async () => {
    const { calls } = stubFetch();
    await fetchGraphSignalsByCity("", { dateFrom: null, dateTo: null });
    expect(calls[0]).toBe("/api/graph-signals/by-city");
  });

  it("fenêtre active : passe dateFrom + dateTo en query (comptes bulk date-cohérents)", async () => {
    const { calls } = stubFetch();
    await fetchGraphSignalsByCity("", { dateFrom: "2026-01-01", dateTo: "2026-08-01" });
    expect(calls[0]).toBe(
      "/api/graph-signals/by-city?dateFrom=2026-01-01&dateTo=2026-08-01",
    );
  });

  it("borne basse seule (ex. 3 derniers mois) : dateFrom seul", async () => {
    const { calls } = stubFetch();
    await fetchGraphSignalsByCity("", { dateFrom: "2026-05-01" });
    expect(calls[0]).toBe("/api/graph-signals/by-city?dateFrom=2026-05-01");
  });
});
