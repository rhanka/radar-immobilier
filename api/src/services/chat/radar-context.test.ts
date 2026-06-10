/**
 * feat(chat): Tests for buildRadarContext + serializeRadarContext.
 *
 * All tests use a mock fetch implementation; no real HTTP calls are made.
 * The deterministic pattern mirrors the ÉV16 backlog-tools tests (vi.stubEnv,
 * injected fetchImpl). No LLM calls.
 */

import { describe, expect, it } from "vitest";
import {
  buildRadarContext,
  serializeRadarContext,
  type RadarContextSnapshot,
} from "./radar-context.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const byCityPayload = {
  ok: true,
  items: [
    { citySlug: "valleyfield", designationEventCount: 5, generatedAt: "2025-01-10T00:00:00.000Z" },
    { citySlug: "chateauguay", designationEventCount: 3, generatedAt: "2025-01-09T00:00:00.000Z" },
    { citySlug: "saint-constant", designationEventCount: 0, generatedAt: null },
  ],
};

const oppPayload = {
  ok: true,
  total: 3,
  scoreVersion: "v1",
  items: [
    {
      citySlug: "valleyfield",
      reglementNumbers: ["1926-26"],
      zoneRefs: ["H-431"],
      label: "Modification de la zone H-431 — densification résidentielle",
      sourceRef: "pv/valleyfield/2025-01-10.pdf",
      dateObserved: "2025-01-10T00:00:00.000Z",
      score: 87,
      facteurs: { proximite: 0.9, zoneType: 0.85, recence: 0.9 },
    },
    {
      citySlug: "chateauguay",
      reglementNumbers: ["Z-3001"],
      zoneRefs: ["RA-2"],
      label: "Changement de zonage RA-2 vers résidentiel mixte",
      sourceRef: "pv/chateauguay/2025-01-09.pdf",
      dateObserved: "2025-01-09T00:00:00.000Z",
      score: 74,
      facteurs: { proximite: 0.8, zoneType: 0.75, recence: 0.8 },
    },
    {
      citySlug: "valleyfield",
      reglementNumbers: ["1928-05"],
      zoneRefs: ["R2"],
      label: "Nouvelle réglementation secteur R2",
      sourceRef: "pv/valleyfield/2025-01-08.pdf",
      dateObserved: "2025-01-08T00:00:00.000Z",
      score: 61,
      facteurs: { proximite: 0.9, zoneType: 0.6, recence: 0.7 },
    },
  ],
};

/**
 * Build a mock fetch that routes /api/signals/by-city and /api/opportunites
 * to the provided payloads.
 */
const makeMockFetch = (
  byCityBody: unknown = byCityPayload,
  oppBody: unknown = oppPayload,
): typeof fetch => {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/signals/by-city")) {
      return new Response(JSON.stringify(byCityBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/api/opportunites")) {
      return new Response(JSON.stringify(oppBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
};

// ─── buildRadarContext ────────────────────────────────────────────────────────

describe("buildRadarContext", () => {
  it("returns cities with non-zero signal counts and top opportunities", async () => {
    const ctx = await buildRadarContext(makeMockFetch());

    expect(ctx.ok).toBe(true);
    expect(ctx.citiesWithZonage).toHaveLength(2); // saint-constant has 0
    expect(ctx.citiesWithZonage.map((c) => c.citySlug)).toEqual([
      "valleyfield",
      "chateauguay",
    ]);
    expect(ctx.totalSignals).toBe(8); // 5 + 3
    expect(ctx.topOpportunites).toHaveLength(3);
    expect(ctx.topOpportunites[0]?.citySlug).toBe("valleyfield");
    expect(ctx.topOpportunites[0]?.score).toBe(87);
  });

  it("limits topOpportunites to 5 even when more are available", async () => {
    const manyItems = Array.from({ length: 10 }, (_, i) => ({
      citySlug: `city-${i}`,
      reglementNumbers: [],
      zoneRefs: [],
      label: `Signal ${i}`,
      sourceRef: "",
      dateObserved: "2025-01-01T00:00:00.000Z",
      score: 100 - i,
      facteurs: { proximite: 0.5, zoneType: 0.5, recence: 0.5 },
    }));
    const fetch = makeMockFetch(byCityPayload, { ...oppPayload, items: manyItems });
    const ctx = await buildRadarContext(fetch);
    expect(ctx.topOpportunites).toHaveLength(5);
  });

  it("returns ok=true with empty arrays when no cities have signals", async () => {
    const emptyByCity = {
      ok: true,
      items: [
        { citySlug: "empty-city", designationEventCount: 0, generatedAt: null },
      ],
    };
    const emptyOpp = { ok: true, total: 0, scoreVersion: "v1", items: [] };
    const ctx = await buildRadarContext(makeMockFetch(emptyByCity, emptyOpp));
    expect(ctx.ok).toBe(true);
    expect(ctx.citiesWithZonage).toHaveLength(0);
    expect(ctx.totalSignals).toBe(0);
    expect(ctx.topOpportunites).toHaveLength(0);
  });

  it("returns ok=false when signals/by-city returns a non-200 status", async () => {
    const failFetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/signals/by-city")) {
        return new Response("error", { status: 500 });
      }
      return new Response(JSON.stringify(oppPayload), { status: 200 });
    }) as typeof fetch;

    const ctx = await buildRadarContext(failFetch);
    expect(ctx.ok).toBe(false);
    expect(ctx.error).toContain("500");
  });

  it("returns ok=false when opportunites returns a non-200 status", async () => {
    const failFetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/opportunites")) {
        return new Response("error", { status: 503 });
      }
      return new Response(JSON.stringify(byCityPayload), { status: 200 });
    }) as typeof fetch;

    const ctx = await buildRadarContext(failFetch);
    expect(ctx.ok).toBe(false);
    expect(ctx.error).toContain("503");
  });

  it("returns ok=false on network error (fetch throws)", async () => {
    const throwFetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;

    const ctx = await buildRadarContext(throwFetch);
    expect(ctx.ok).toBe(false);
    expect(ctx.error).toContain("ECONNREFUSED");
  });

  it("uses PORT env var for the internal base URL", async () => {
    const calls: string[] = [];
    const captureFetch = (async (input: RequestInfo | URL) => {
      calls.push(typeof input === "string" ? input : input.toString());
      return new Response(
        JSON.stringify(
          calls[calls.length - 1]?.includes("by-city") ? byCityPayload : oppPayload,
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    await buildRadarContext(captureFetch, { PORT: "4567" } as NodeJS.ProcessEnv);
    expect(calls.every((url) => url.startsWith("http://127.0.0.1:4567"))).toBe(true);
  });
});

// ─── serializeRadarContext ────────────────────────────────────────────────────

describe("serializeRadarContext", () => {
  it("produces a readable French summary with city list and top opportunities", () => {
    const ctx: RadarContextSnapshot = {
      builtAt: "2025-01-15T10:00:00.000Z",
      ok: true,
      citiesWithZonage: [
        { citySlug: "valleyfield", designationEventCount: 5 },
        { citySlug: "chateauguay", designationEventCount: 3 },
      ],
      totalSignals: 8,
      topOpportunites: [
        {
          citySlug: "valleyfield",
          label: "Modification de la zone H-431",
          score: 87,
          zoneRefs: ["H-431"],
          reglementNumbers: ["1926-26"],
        },
      ],
    };

    const text = serializeRadarContext(ctx);
    expect(text).toContain("[CONTEXTE RADAR");
    expect(text).toContain("8 événement");
    expect(text).toContain("valleyfield (5)");
    expect(text).toContain("chateauguay (3)");
    expect(text).toContain("score 87");
    expect(text).toContain("H-431");
    expect(text).toContain("1926-26");
    expect(text).toContain("Modification de la zone H-431");
  });

  it("mentions unavailability when ok=false", () => {
    const ctx: RadarContextSnapshot = {
      builtAt: "2025-01-15T10:00:00.000Z",
      ok: false,
      error: "signals/by-city HTTP 500",
      citiesWithZonage: [],
      totalSignals: 0,
      topOpportunites: [],
    };
    const text = serializeRadarContext(ctx);
    expect(text).toContain("non disponibles");
    expect(text).toContain("HTTP 500");
  });

  it("mentions empty state when no signals are available", () => {
    const ctx: RadarContextSnapshot = {
      builtAt: "2025-01-15T10:00:00.000Z",
      ok: true,
      citiesWithZonage: [],
      totalSignals: 0,
      topOpportunites: [],
    };
    const text = serializeRadarContext(ctx);
    expect(text).toContain("Aucun signal");
    expect(text).toContain("Aucune opportunité");
  });
});
