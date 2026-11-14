import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSignalMetadata, metadataCityItems } from "./signal-metadata-client.js";
import { buildCityMapEntries } from "$lib/maps/maps-data.js";
import { displayedSignalCountForCity } from "./signal-filter-counts.js";
import { DEFAULT_CLASSEMENT_FILTER } from "./signal-classement.js";
import type { SignalMetadataResponse } from "@radar/domain";

afterEach(() => vi.unstubAllGlobals());
const scope = { workspaceId: "11111111-1111-4111-8111-111111111111" };
const response: SignalMetadataResponse = { contract: "metadata-v2", snapshot: "sample", totalMatched: 3,
  classCounts: { pertinent: 1, a_surveiller: 0, non_classe: 2, ecarte: 4 },
  facetCounts: { z: 3, r: 3, p: 3, piia: 0, derog: 0 }, cities: [{ citySlug: "delson", matched: 3,
    classCounts: { pertinent: 1, a_surveiller: 0, non_classe: 2, ecarte: 4 },
    facetCounts: { z: 3, r: 3, p: 3, piia: 0, derog: 0 },
    facetsByClass: { pertinent: { "11100": 1 }, a_surveiller: {}, non_classe: { "11100": 2 }, ecarte: { "11100": 4 } },
  }] };

describe("map metadata boundary", () => {
  it("should request the explicit metadata contract with inclusive dates", async () => {
    const fetch = vi.fn(async (_url: string) => new Response(JSON.stringify(response)));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchSignalMetadata(scope, { dateFrom: "2026-11-01", dateBasis: "scrap" })).resolves.toEqual(response);
    const params = new URL(String(fetch.mock.calls[0]?.[0]), "http://localhost").searchParams;
    expect(Object.fromEntries(params)).toEqual({ contract: "metadata-v2", scope: "quebec", dateFrom: "2026-11-01", dateBasis: "scrap" });
  });
  it("should fail explicitly against an old server without a second request", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, totalCount: 3, cities: [] })));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchSignalMetadata(scope)).rejects.toThrow("unsupported response");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("should retain exact class cubes for every local filter without cards", () => {
    const city = buildCityMapEntries(metadataCityItems(response)).find((c) => c.municipality.slug === "delson")!;
    const exclusions = { piiaSansProjetResidentiel: true, derogationsMineures: true };
    expect(displayedSignalCountForCity(city, "vivier-v2", DEFAULT_CLASSEMENT_FILTER, exclusions)).toBe(3);
    expect(displayedSignalCountForCity(city, "vivier-v2", { ...DEFAULT_CLASSEMENT_FILTER, ecarte: true }, exclusions)).toBe(7);
  });
});
