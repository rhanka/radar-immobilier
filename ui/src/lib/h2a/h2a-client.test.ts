import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchJournal,
  fetchPolicy,
  recordDecision,
  type JournalSnapshot,
} from "./h2a-client.js";

const emptySnapshot: JournalSnapshot = {
  protocol: "sentropic.h2a",
  version: "0.1",
  scope: "scope:radar",
  policyIds: ["policy:radar:principal-is-human"],
  actors: [
    { by: "principal@radar", role: "PRINCIPAL" },
    { by: "conductor@radar", role: "CONDUCTOR" },
  ],
  entries: [],
  chainValid: true,
};

const jsonResponse = (body: unknown, ok = true, status = 200): Response =>
  ({ ok, status, json: async () => body }) as unknown as Response;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchJournal", () => {
  it("GETs the journal endpoint and returns the snapshot", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(emptySnapshot));
    vi.stubGlobal("fetch", fetchMock);

    const snap = await fetchJournal("");
    expect(fetchMock).toHaveBeenCalledWith("/api/h2a/journal");
    expect(snap.chainValid).toBe(true);
    expect(snap.actors.map((a) => a.role)).toContain("PRINCIPAL");
  });

  it("prefixes the base URL when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(emptySnapshot));
    vi.stubGlobal("fetch", fetchMock);

    await fetchJournal("http://api.test/");
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/api/h2a/journal");
  });

  it("throws on HTTP error (so the view can show 'non connecté')", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(null, false, 503)));
    await expect(fetchJournal("")).rejects.toThrow(/503/);
  });
});

describe("fetchPolicy", () => {
  it("returns the POLICY artifacts", async () => {
    const body = { scope: "scope:radar", policies: [{ kind: "POLICY", id: "policy:radar:loi-25" }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(body)));
    const res = await fetchPolicy("");
    expect(res.policies[0]?.id).toBe("policy:radar:loi-25");
  });
});

describe("recordDecision", () => {
  it("POSTs the decision and returns the new snapshot", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(emptySnapshot, true, 201));
    vi.stubGlobal("fetch", fetchMock);

    await recordDecision({ kind: "qualifier", entity: "H-609-4" }, "");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/h2a/decisions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ kind: "qualifier", entity: "H-609-4" }),
      }),
    );
  });

  it("surfaces the server error message on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "Invalid request" }, false, 400)),
    );
    await expect(
      recordDecision({ kind: "qualifier", entity: "" }, ""),
    ).rejects.toThrow(/Invalid request/);
  });
});
