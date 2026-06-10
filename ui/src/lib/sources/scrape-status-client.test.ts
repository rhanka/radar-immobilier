import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  fetchScrapeStatus,
  resolveScrapeStatusUrl,
} from "./scrape-status-client.js";
import type { ScrapeStatusT } from "@radar/domain";

describe("resolveScrapeStatusUrl", () => {
  it("returns path directly when no baseUrl", () => {
    expect(resolveScrapeStatusUrl("/api/scrape-status", "")).toBe(
      "/api/scrape-status",
    );
  });
  it("appends path to baseUrl stripping trailing slash", () => {
    expect(
      resolveScrapeStatusUrl("/api/scrape-status", "http://localhost:3000/"),
    ).toBe("http://localhost:3000/api/scrape-status");
  });
});

describe("fetchScrapeStatus", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("city=valleyfield")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                citySlug: "valleyfield",
                source: "zonage",
                automation: "one_shot",
                status: "scraped",
                windowMonths: 6,
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("fetches all items when no city filter", async () => {
    const res = await fetchScrapeStatus(undefined, "");
    expect(res.items).toEqual([]);
  });

  it("fetches city-filtered items", async () => {
    const res = await fetchScrapeStatus("valleyfield", "");
    expect(res.items).toHaveLength(1);
    expect(res.items[0].citySlug).toBe("valleyfield");
  });

  it("throws on HTTP error", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
    await expect(fetchScrapeStatus(undefined, "")).rejects.toThrow(
      "scrape-status HTTP 500",
    );
  });
});
