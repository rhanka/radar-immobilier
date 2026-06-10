/**
 * Tests for opportunites-client.ts
 *
 * Coverage:
 *   1. resolveOpportunitesUrl — URL construction
 *   2. fetchOpportunites — mock fetch responses
 *   3. Score rank invariant — higher score items appear first
 *   4. Facteurs fields are numeric in [0,1]
 *   5. Error on HTTP failure
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchOpportunites,
  resolveOpportunitesUrl,
  type OpportuniteItem,
  type OpportunitesResponse,
} from "./opportunites-client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeItem(citySlug: string, score: number): OpportuniteItem {
  return {
    citySlug,
    reglementNumbers: ["1001-26"],
    zoneRefs: ["H-101"],
    label: `Avis de motion règlement de zonage 1001-26 (zone H-101) — ${citySlug}`,
    sourceRef: `raw/proces-verbaux-${citySlug}/2026/05/12/pv.txt`,
    dateObserved: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    score,
    facteurs: { proximite: 1.00, zoneType: 1.00, recence: 0.80 },
  };
}

const RESPONSE_TWO_ITEMS: OpportunitesResponse = {
  ok: true,
  total: 2,
  scoreVersion: "v1",
  items: [
    makeItem("sainte-catherine", 92),
    makeItem("salaberry-de-valleyfield", 36),
  ],
};

const RESPONSE_EMPTY: OpportunitesResponse = {
  ok: true,
  total: 0,
  scoreVersion: "v1",
  items: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. URL construction
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveOpportunitesUrl", () => {
  it("returns path-only when no baseUrl provided", () => {
    expect(resolveOpportunitesUrl("")).toBe("/api/opportunites");
  });

  it("prepends baseUrl with trailing slash stripped", () => {
    expect(resolveOpportunitesUrl("http://api:3000/")).toBe(
      "http://api:3000/api/opportunites",
    );
  });

  it("prepends baseUrl without trailing slash", () => {
    expect(resolveOpportunitesUrl("http://api:3000")).toBe(
      "http://api:3000/api/opportunites",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. fetchOpportunites — success
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchOpportunites — success", () => {
  it("returns response with ok:true and items", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(RESPONSE_TWO_ITEMS), { status: 200 }),
    );
    const res = await fetchOpportunites("");
    expect(res.ok).toBe(true);
    expect(res.total).toBe(2);
    expect(res.items).toHaveLength(2);
    expect(res.scoreVersion).toBe("v1");
  });

  it("returns empty items list when no opportunities", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(RESPONSE_EMPTY), { status: 200 }),
    );
    const res = await fetchOpportunites("");
    expect(res.ok).toBe(true);
    expect(res.total).toBe(0);
    expect(res.items).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Score rank invariant
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchOpportunites — score rank invariant", () => {
  it("items are sorted by score descending (first item has highest score)", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(RESPONSE_TWO_ITEMS), { status: 200 }),
    );
    const res = await fetchOpportunites("");
    for (let i = 0; i < res.items.length - 1; i++) {
      expect(res.items[i]!.score).toBeGreaterThanOrEqual(res.items[i + 1]!.score);
    }
  });

  it("first item has score 92 (sainte-catherine)", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(RESPONSE_TWO_ITEMS), { status: 200 }),
    );
    const res = await fetchOpportunites("");
    expect(res.items[0]!.score).toBe(92);
    expect(res.items[0]!.citySlug).toBe("sainte-catherine");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Facteurs fields
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchOpportunites — facteurs", () => {
  it("each item has facteurs with proximite, zoneType, recence in [0,1]", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(RESPONSE_TWO_ITEMS), { status: 200 }),
    );
    const res = await fetchOpportunites("");
    for (const item of res.items) {
      expect(typeof item.facteurs.proximite).toBe("number");
      expect(item.facteurs.proximite).toBeGreaterThanOrEqual(0);
      expect(item.facteurs.proximite).toBeLessThanOrEqual(1);
      expect(typeof item.facteurs.zoneType).toBe("number");
      expect(item.facteurs.zoneType).toBeGreaterThanOrEqual(0);
      expect(item.facteurs.zoneType).toBeLessThanOrEqual(1);
      expect(typeof item.facteurs.recence).toBe("number");
      expect(item.facteurs.recence).toBeGreaterThanOrEqual(0);
      expect(item.facteurs.recence).toBeLessThanOrEqual(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Error handling
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchOpportunites — errors", () => {
  it("throws on HTTP 500", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
    await expect(fetchOpportunites("")).rejects.toThrow("opportunites HTTP 500");
  });

  it("throws when ok=false in JSON", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ ok: false, total: 0, scoreVersion: "v1", items: [] }), {
        status: 200,
      }),
    );
    await expect(fetchOpportunites("")).rejects.toThrow("opportunites: api returned ok=false");
  });
});
