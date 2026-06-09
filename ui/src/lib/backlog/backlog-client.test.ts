import { afterEach, describe, expect, it, vi } from "vitest";

import { addBacklogItem, fetchBacklog, resolveBacklogUrl } from "./backlog-client.js";
import type { BacklogItem } from "./backlog-data.js";

const jsonResponse = (body: unknown, ok = true, status = 200): Response =>
  ({ ok, status, json: async () => body }) as unknown as Response;

const trackedItem: BacklogItem = {
  id: "01KTMHTE8YCBE0596AB6SJRYE4",
  code: "WP4-SOURCES",
  titre: "WP4-A — Investigation données réelles multi-villes",
  description: "wp4-sources · feature · Acceptation : ✓ pass",
  statut: "realise",
  source: "track",
  groupe: "wp4-sources",
  acceptance: "pass",
  bucket: "DONE",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveBacklogUrl", () => {
  it("returns the bare path when no base url", () => {
    expect(resolveBacklogUrl("/api/backlog", undefined)).toBe("/api/backlog");
  });
  it("prefixes the base url (trailing slash trimmed)", () => {
    expect(resolveBacklogUrl("/api/backlog", "http://api.test/")).toBe(
      "http://api.test/api/backlog",
    );
  });
});

describe("fetchBacklog", () => {
  it("returns the tracked items and propagates source: 'track'", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [trackedItem], source: "track" }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await fetchBacklog("");
    expect(fetchMock).toHaveBeenCalledWith("/api/backlog");
    expect(res.source).toBe("track");
    expect(res.items[0]?.id).toBe(trackedItem.id);
    expect(res.items[0]?.acceptance).toBe("pass");
  });

  it("defaults source to 'ev-fallback' when the API omits it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await fetchBacklog("");
    expect(res.source).toBe("ev-fallback");
  });

  it("throws on HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, false, 500)));
    await expect(fetchBacklog("")).rejects.toThrow(/500/);
  });
});

describe("addBacklogItem", () => {
  it("POSTs the request and returns the created item", async () => {
    const created: BacklogItem = {
      id: "carte-interactive",
      code: "Demande",
      titre: "Carte interactive",
      description: "MapLibre",
      statut: "a-faire",
      source: "request",
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ item: created }, true, 201));
    vi.stubGlobal("fetch", fetchMock);

    const item = await addBacklogItem({ titre: "Carte interactive", description: "MapLibre" }, "");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/backlog/items",
      expect.objectContaining({ method: "POST" }),
    );
    expect(item.id).toBe("carte-interactive");
    expect(item.statut).toBe("a-faire");
  });
});
