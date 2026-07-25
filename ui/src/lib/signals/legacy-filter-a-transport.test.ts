/**
 * GOLDEN — legacy Filter A, ROUTE → UI TRANSPORT. Anti-regression gate.
 *
 * The UI display golden proves `projectNodesForVivierKey` is stable GIVEN a
 * payload; this one proves the payload the SERVER actually serializes still
 * feeds it. It replays the API-frozen transport bytes
 * (`api/tests/fixtures/graphify/legacy-filter-a/route-transport.golden.json`,
 * written by `api/src/routes/legacy-filter-a-transport-golden.test.ts`) through
 * the REAL client `fetchGraphSignalDetail` — served by a stubbed `fetch`, so the
 * bytes really cross the client parse — and then through the exact projection
 * call SignauxMapView makes (`projectNodesForVivierKey(detailNodes,
 * detailLegacyProjection, activeSubsetKey)`, SignauxMapView.svelte:549).
 *
 * Covered at that frontier: nominal members/order per legacy subset, the empty
 * city, the 404 shape, and corrupt/absent authority or membership (fail-closed).
 * If the `legacySubset` / `legacyProjection` mapping regresses on EITHER side of
 * the wire, this test and its API twin go red — a layer-local golden cannot.
 *
 * The fixture is READ ACROSS workspaces on purpose: one artifact, one contract,
 * no second copy to drift. Do NOT regenerate it to make this pass.
 *
 * Pure: no Docker, no API process, no Svelte component — only a stubbed fetch.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchGraphSignalDetail,
  type GraphSignalDetailResponse,
} from "./graph-signal-detail-client.js";
import { projectNodesForVivierKey } from "./vivier-view-mode.js";
import expectedFixture from "./fixtures/legacy-filter-a-transport-expected.json";

// Resolved from this module's own path (NOT `new URL(..., import.meta.url)`,
// which Vite rewrites to an /@fs http URL for paths outside the UI root).
const HERE = dirname(fileURLToPath(import.meta.url));
const apiFixture = (name: string): string =>
  resolve(HERE, "../../../../api/tests/fixtures/graphify/legacy-filter-a", name);
const golden = JSON.parse(readFileSync(apiFixture("route-transport.golden.json"), "utf8")) as {
  city: string;
  ok200: unknown;
  notFound404: unknown;
};
const expected = expectedFixture as { projectionMembers: Record<string, string[]> };

/** Serve `body` as the response bytes of GET /api/graph-signals/:city. */
function serve(status: number, body: unknown): void {
  const bytes = JSON.stringify(body);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => JSON.parse(bytes),
    })),
  );
}

/** What SignauxMapView holds after loadDetailForCity (SignauxMapView.svelte:1019). */
async function loadCity(status: number, body: unknown): Promise<GraphSignalDetailResponse> {
  serve(status, body);
  return fetchGraphSignalDetail(golden.city);
}

/** The exact projection call the view makes on the fetched response. */
async function renderIds(subsetKey: string, body: unknown = golden.ok200): Promise<string[]> {
  const res = await loadCity(200, body);
  return projectNodesForVivierKey(res.nodes, res.legacyProjection, subsetKey).nodes.map(
    (n) => n.id,
  );
}

/** Structural mutation of the served payload — the wire is what we corrupt. */
function mutate(fn: (payload: Record<string, unknown>) => void): unknown {
  const clone = JSON.parse(JSON.stringify(golden.ok200)) as Record<string, unknown>;
  fn(clone);
  return clone;
}

const unavailable = { available: false, count: null, nodes: [] };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("legacy Filter A transport golden — the served payload feeds the display", () => {
  for (const key of Object.keys(expected.projectionMembers)) {
    it(`subset "${key}" renders the frozen ordered members from the SERVED bytes`, async () => {
      expect(await renderIds(key)).toEqual(expected.projectionMembers[key]);
    });
  }

  it("z|m|p is the exact served authority (available, count, order)", async () => {
    const res = await loadCity(200, golden.ok200);
    const projected = projectNodesForVivierKey(res.nodes, res.legacyProjection, "z|m|p");
    expect(projected.available).toBe(true);
    expect(projected.count).toBe(res.legacyProjection!.a.count);
    expect(projected.nodes.map((n) => n.id)).toEqual(res.legacyProjection!.a.signalIds);
  });
});

describe("legacy Filter A transport golden — fail-closed at the wire", () => {
  it("404 yields the honest empty state, and the projection is unavailable", async () => {
    const res = await loadCity(404, golden.notFound404);
    expect(res).toEqual({ ok: false, citySlug: golden.city, legacyProjection: null, nodes: [] });
    expect(projectNodesForVivierKey(res.nodes, res.legacyProjection, "z|m|p")).toEqual(unavailable);
  });

  it("a 5xx is an error, never a silently empty map", async () => {
    serve(500, { ok: false });
    await expect(fetchGraphSignalDetail(golden.city)).rejects.toThrow(/500/);
  });

  it("a payload served WITHOUT legacyProjection is fail-closed on z|m|p", async () => {
    const body = mutate((p) => {
      delete p.legacyProjection;
    });
    const res = await loadCity(200, body);
    expect(projectNodesForVivierKey(res.nodes, res.legacyProjection, "z|m|p")).toEqual(unavailable);
  });

  it("a served authority with the wrong order is rejected", async () => {
    const body = mutate((p) => {
      const a = (p.legacyProjection as { a: { signalIds: string[] } }).a;
      a.signalIds = [...a.signalIds].reverse();
    });
    expect(await renderIds("z|m|p", body)).toEqual([]);
  });

  it("a served authority that over-claims the A set is rejected", async () => {
    const body = mutate((p) => {
      const a = (p.legacyProjection as { a: { count: number; signalIds: string[] } }).a;
      a.signalIds = ["alpha-s1", "alpha-s2", "alpha-s4"];
      a.count = 3;
    });
    expect(await renderIds("z|m|p", body)).toEqual([]);
  });

  it("a served node whose legacySubset is dropped is fail-closed (all keys)", async () => {
    const body = mutate((p) => {
      delete (p.nodes as Array<Record<string, unknown>>)[0]!.legacySubset;
    });
    expect(await renderIds("z|m|p", body)).toEqual([]);
    expect(await renderIds("z", body)).toEqual([]);
  });

  it("a served node whose legacySubset.signalId disagrees is fail-closed", async () => {
    const body = mutate((p) => {
      const node = (p.nodes as Array<Record<string, unknown>>)[0]!;
      (node.legacySubset as Record<string, unknown>).signalId = "mismatch";
    });
    expect(await renderIds("z|m|p", body)).toEqual([]);
  });

  it("an empty city (no nodes, empty authority) is available with count 0", async () => {
    const body = mutate((p) => {
      p.nodes = [];
      p.legacyProjection = { version: "legacy-zmp-v1", a: { count: 0, signalIds: [] } };
    });
    const res = await loadCity(200, body);
    expect(projectNodesForVivierKey(res.nodes, res.legacyProjection, "z|m|p")).toEqual({
      available: true,
      count: 0,
      nodes: [],
    });
  });
});

describe("legacy Filter A transport golden — cross-layer count parity", () => {
  it("each rendered subset has EXACTLY the server-golden bulk count", () => {
    const serverGolden = JSON.parse(readFileSync(apiFixture("expected.json"), "utf8")) as {
      cities: Record<string, { subsetCounts: Record<string, number> }>;
    };
    const counts = serverGolden.cities[golden.city]!.subsetCounts;
    for (const [key, members] of Object.entries(expected.projectionMembers)) {
      expect(members.length, `subset "${key}"`).toBe(counts[key]);
    }
  });
});
