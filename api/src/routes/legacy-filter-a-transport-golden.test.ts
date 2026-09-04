/**
 * GOLDEN — legacy Filter A, ROUTE TRANSPORT. Anti-regression gate.
 *
 * The server-layer golden pins the legacy A FUNCTIONS and the UI golden pins the
 * DISPLAY projection, but neither pins what actually travels between them. This
 * one freezes the payload `GET /api/graph-signals/:city` REALLY serializes for
 * the frozen legacy-A corpus — the route's own `legacyProjection` + per-node
 * `legacySubset` mapping (graph-signals.ts, the `c.json(...)` at the end of the
 * per-city handler) — as read back from the response BYTES, plus its 404 shape.
 *
 * The frozen bytes live in `tests/fixtures/graphify/legacy-filter-a/
 * route-transport.golden.json` and are CONSUMED by the UI test
 * `ui/src/lib/signals/legacy-filter-a-transport.test.ts`, which replays them
 * through the real client + the real display projection. So a rename, a drop, or
 * a reshaping of `legacySubset` / `legacyProjection` on either side of the wire
 * turns this pair red instead of silently passing two layer-local goldens.
 *
 * Do NOT regenerate the golden to make it pass — a divergence is the signal.
 *
 * Only the DB read is mocked (no Postgres); the route, the classification and
 * the JSON serialization are the real ones. The store is in-memory: no S3.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the graph-store module so the test does not touch Postgres. Everything
// else (classification, projection, serialization) runs for real.
vi.mock("../services/graph/graph-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/graph/graph-store.js")>();
  return {
    ...actual,
    getSignalNodesForCity: vi.fn(),
    listCitiesWithSignalNodes: vi.fn(),
    // The alpha corpus has no raises_signal links; keep the §7.6 post-pass a
    // no-op so the frozen payload stays byte-for-byte unchanged (no citationFromEvent).
    getRaisesSignalLinks: vi.fn().mockResolvedValue([]),
  };
});

import { graphSignalsRoute } from "./graph-signals.js";
import { getSignalNodesForCity } from "../services/graph/graph-store.js";
import type { Database } from "../db/client.js";
import type { ObjectInfo, ObjectStore } from "../storage/object-store.js";

const CITY = "alpha";

function readFixture<T>(name: string): T {
  const url = new URL(`../../tests/fixtures/graphify/legacy-filter-a/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as T;
}

interface FixtureRow {
  id: string;
  citySlug: string;
  type: string;
  label: string;
  sourceRef: string | null;
  props: Record<string, unknown>;
}
type NodeRows = Awaited<ReturnType<typeof getSignalNodesForCity>>;

/** The SAME corpus as the server golden, given the DB columns the route reads. */
function cityRows(city: string): NodeRows {
  const frozen = new Date("2026-07-24T00:00:00.000Z");
  return readFixture<FixtureRow[]>("rows.json")
    .filter((row) => row.citySlug === city)
    .map((row) => ({ ...row, createdAt: frozen, updatedAt: frozen })) as unknown as NodeRows;
}

interface TransportGolden {
  _note: string;
  city: string;
  ok200: { ok: boolean; citySlug: string; legacyProjection: unknown; nodes: unknown[] };
  notFound404: { ok: boolean; error: string; citySlug: string };
}
const golden = readFixture<TransportGolden>("route-transport.golden.json");

/** Store that holds nothing: doc enrichment degrades, no network, no S3. */
class EmptyStore implements ObjectStore {
  async put(key: string): Promise<ObjectInfo> {
    return { key };
  }
  async get(key: string): Promise<Uint8Array> {
    throw new Error(`missing ${key}`);
  }
  async head(): Promise<ObjectInfo | null> {
    return null;
  }
  async list(): Promise<string[]> {
    return [];
  }
}

function route() {
  return graphSignalsRoute({
    db: {} as Database,
    store: new EmptyStore(),
    docEnrichmentBudgetMs: 1_000,
  });
}

beforeEach(() => {
  vi.mocked(getSignalNodesForCity).mockReset();
});

describe("legacy Filter A golden — GET /api/graph-signals/:city transport payload", () => {
  it("serializes EXACTLY the frozen payload (bytes read back from the response)", async () => {
    vi.mocked(getSignalNodesForCity).mockResolvedValueOnce(cityRows(CITY));

    const res = await route().request(`/api/graph-signals/${CITY}`);
    const body = JSON.parse(await res.text()) as TransportGolden["ok200"];

    expect(res.status).toBe(200);
    expect(body).toEqual(golden.ok200);
  });

  it("the served legacyProjection matches the server-layer golden A ids", async () => {
    const expected = readFixture<{ cities: Record<string, { aProjectionIds: string[] }> }>(
      "expected.json",
    );
    vi.mocked(getSignalNodesForCity).mockResolvedValueOnce(cityRows(CITY));

    const res = await route().request(`/api/graph-signals/${CITY}`);
    const body = (await res.json()) as TransportGolden["ok200"];
    const projection = body.legacyProjection as {
      version: string;
      a: { count: number; signalIds: string[] };
    };

    expect(projection.version).toBe("legacy-zmp-v1");
    expect(projection.a.signalIds).toEqual(expected.cities[CITY]!.aProjectionIds);
    expect(projection.a.count).toBe(projection.a.signalIds.length);
  });

  it("every served node carries a self-consistent legacySubset membership", async () => {
    vi.mocked(getSignalNodesForCity).mockResolvedValueOnce(cityRows(CITY));

    const res = await route().request(`/api/graph-signals/${CITY}`);
    const body = (await res.json()) as {
      nodes: Array<{ id: string; legacySubset: { version: string; signalId: string } }>;
    };

    for (const node of body.nodes) {
      expect(node.legacySubset.version).toBe("legacy-zmp-v1");
      expect(node.legacySubset.signalId).toBe(node.id); // the client fail-closes otherwise
    }
  });

  it("a city with no signal nodes serializes the frozen 404 payload", async () => {
    vi.mocked(getSignalNodesForCity).mockResolvedValueOnce([] as unknown as NodeRows);

    const res = await route().request("/api/graph-signals/ville-inconnue");
    const body = JSON.parse(await res.text()) as TransportGolden["notFound404"];

    expect(res.status).toBe(404);
    expect(body).toEqual(golden.notFound404);
  });
});
