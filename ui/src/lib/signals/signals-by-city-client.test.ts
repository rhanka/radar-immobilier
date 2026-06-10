import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  fetchSignalsByCity,
  resolveSignalsByCityUrl,
  type SignalsByCityResponse,
} from "./signals-by-city-client.js";

describe("resolveSignalsByCityUrl", () => {
  it("returns path directly when no baseUrl", () => {
    expect(resolveSignalsByCityUrl("")).toBe("/api/signals/by-city");
  });

  it("appends path to baseUrl stripping trailing slash", () => {
    expect(resolveSignalsByCityUrl("http://localhost:3000/")).toBe(
      "http://localhost:3000/api/signals/by-city",
    );
  });
});

const MOCK_RESPONSE: SignalsByCityResponse = {
  ok: true,
  items: [
    { citySlug: "salaberry-de-valleyfield", designationEventCount: 3, generatedAt: "2026-06-08T00:00:00.000Z" },
    { citySlug: "beauharnois", designationEventCount: 0, generatedAt: null },
  ],
};

describe("fetchSignalsByCity", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(MOCK_RESPONSE), { status: 200 }),
    );
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("returns parsed items from the API", async () => {
    const res = await fetchSignalsByCity("");
    expect(res.ok).toBe(true);
    expect(res.items).toHaveLength(2);
    expect(res.items[0].citySlug).toBe("salaberry-de-valleyfield");
    expect(res.items[0].designationEventCount).toBe(3);
  });

  it("throws on HTTP error", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
    await expect(fetchSignalsByCity("")).rejects.toThrow(
      "signals/by-city HTTP 500",
    );
  });

  it("throws when api returns ok=false", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ ok: false, items: [] }), { status: 200 }),
    );
    await expect(fetchSignalsByCity("")).rejects.toThrow("ok=false");
  });
});
