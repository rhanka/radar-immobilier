/**
 * WP A.3.x — Graph-signals route unit tests.
 *
 * Tests the Hono route layer for graph-signals endpoints.
 * Uses vitest.mock to mock graph-store functions — no Postgres required.
 *
 * Endpoints under test:
 *   GET /api/graph-signals/by-city  — aggregate signal counts per city
 *   GET /api/graph-signals/:city    — Signal+DesignationEvent nodes for one city
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { graphSignalsRoute } from "./graph-signals.js";
import type { Database } from "../db/client.js";

// Mock the graph-store module so tests do not touch Postgres.
vi.mock("../services/graph/graph-store.js", () => ({
  listCitiesWithSignalNodes: vi.fn(),
  getSignalNodesForCity: vi.fn(),
}));

import {
  listCitiesWithSignalNodes,
  getSignalNodesForCity,
} from "../services/graph/graph-store.js";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeNode(id: string, citySlug: string, type = "Signal") {
  return {
    id,
    citySlug,
    type,
    label: `Node ${id}`,
    props: {},
    sourceRef: null,
    createdAt: new Date("2025-03-15T10:00:00Z"),
  };
}

// Minimal mock DB (never actually called — graph-store is mocked).
const mockDb = {} as unknown as Database;

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/graph-signals/by-city", () => {
  it("returns ok:true with empty cities when no signal nodes exist", async () => {
    vi.mocked(listCitiesWithSignalNodes).mockResolvedValueOnce([]);

    const app = graphSignalsRoute({ db: mockDb });
    const res = await app.request("/api/graph-signals/by-city");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      totalCount: number;
      cities: { citySlug: string; signalCount: number; countsByType: Record<string, number>; zonageCount: number }[];
    };
    expect(body.ok).toBe(true);
    expect(body.totalCount).toBe(0);
    expect(body.cities).toEqual([]);
  });

  it("returns ok:true with city list, correct totalCount, and zonageCount", async () => {
    vi.mocked(listCitiesWithSignalNodes).mockResolvedValueOnce([
      { citySlug: "drummondville", signalCount: 5, countsByType: { Signal: 3, DesignationEvent: 2 }, zonageCount: 4 },
      { citySlug: "saint-constant", signalCount: 3, countsByType: { Signal: 3 }, zonageCount: 1 },
    ]);

    const app = graphSignalsRoute({ db: mockDb });
    const res = await app.request("/api/graph-signals/by-city");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      totalCount: number;
      cities: { citySlug: string; signalCount: number; countsByType: Record<string, number>; zonageCount: number }[];
    };
    expect(body.ok).toBe(true);
    expect(body.totalCount).toBe(8);
    expect(body.cities).toHaveLength(2);
    expect(body.cities[0]).toEqual({
      citySlug: "drummondville",
      signalCount: 5,
      countsByType: { Signal: 3, DesignationEvent: 2 },
      zonageCount: 4,
    });
    expect(body.cities[1]).toEqual({
      citySlug: "saint-constant",
      signalCount: 3,
      countsByType: { Signal: 3 },
      zonageCount: 1,
    });
    // zonageCount < signalCount quand il y a des signaux non-zonage
    expect(body.cities[1]!.zonageCount).toBeLessThan(body.cities[1]!.signalCount);
    expect(body.cities[0]!.countsByType).toEqual({ Signal: 3, DesignationEvent: 2 });
  });
});

describe("GET /api/graph-signals/:city", () => {
  it("returns 404 with ok:false when no signal nodes exist for the city", async () => {
    vi.mocked(getSignalNodesForCity).mockResolvedValueOnce([]);

    const app = graphSignalsRoute({ db: mockDb });
    const res = await app.request("/api/graph-signals/ville-inconnue");

    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      ok: boolean;
      error: string;
      citySlug: string;
    };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("no_signal_nodes");
    expect(body.citySlug).toBe("ville-inconnue");
  });

  it("returns ok:true with mapped nodes for a city with signal nodes", async () => {
    const nodes = [
      makeNode("sig-001", "drummondville", "Signal"),
      makeNode("evt-002", "drummondville", "DesignationEvent"),
    ];
    vi.mocked(getSignalNodesForCity).mockResolvedValueOnce(nodes as ReturnType<typeof makeNode>[]);

    const app = graphSignalsRoute({ db: mockDb });
    const res = await app.request("/api/graph-signals/drummondville");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      citySlug: string;
      nodes: { id: string; type: string; label: string; createdAt: string | null }[];
    };
    expect(body.ok).toBe(true);
    expect(body.citySlug).toBe("drummondville");
    expect(body.nodes).toHaveLength(2);
    expect(body.nodes[0]!.id).toBe("sig-001");
    expect(body.nodes[0]!.type).toBe("Signal");
    expect(body.nodes[1]!.type).toBe("DesignationEvent");
    // createdAt is serialized to ISO string
    expect(body.nodes[0]!.createdAt).toBe("2025-03-15T10:00:00.000Z");
  });

  it("returns ok:true with props and sourceRef when present", async () => {
    const nodeWithProps = {
      ...makeNode("sig-003", "drummondville", "Signal"),
      sourceRef: "s3://bucket/proc-verbal.pdf",
      props: { reglement_number: "1234-56", zone_ref: "H-431" },
    };
    vi.mocked(getSignalNodesForCity).mockResolvedValueOnce([nodeWithProps] as unknown as ReturnType<typeof makeNode>[]);

    const app = graphSignalsRoute({ db: mockDb });
    const res = await app.request("/api/graph-signals/drummondville");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      nodes: { sourceRef: string | null; props: Record<string, unknown> }[];
    };
    expect(body.nodes[0]!.sourceRef).toBe("s3://bucket/proc-verbal.pdf");
    expect(body.nodes[0]!.props).toEqual({ reglement_number: "1234-56", zone_ref: "H-431" });
  });
});
