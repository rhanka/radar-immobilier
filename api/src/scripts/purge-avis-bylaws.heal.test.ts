/**
 * purge-avis-bylaws — mode `--heal` : source-swap PG vs S3 dans `loadCityGraph`.
 *
 * Mocke les 4 fonctions source pour PROUVER le branchement (heal→PG, défaut→S3)
 * + le câblage du retour `{graph, readAnchor}`. Le round-trip PG lui-même
 * (`snapshotFromExistingCity(subgraphForCity)`) est couvert côté graphify-34 ; le
 * vrai check end-to-end = k8s re-run `--heal` des 2 villes drift (reprojected:1,
 * aborted:0). Fichier SÉPARÉ du test pur `planCityPurge` (qui ne mocke rien).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/graph/graph-store.js", () => ({
  subgraphForCity: vi.fn(),
  upsertGraphAtomic: vi.fn(),
}));
vi.mock("../services/graph/graphify-34-snapshot.js", () => ({
  snapshotFromExistingCity: vi.fn(),
}));
vi.mock("../services/graph/canonical-graph-writer.js", () => ({
  archiveCityGraphPrefix: vi.fn(),
  captureCanonicalReadAnchor: vi.fn(),
  readCanonicalCityGraph: vi.fn(),
  writeCanonicalCityGraph: vi.fn(),
}));

import { loadCityGraph } from "./purge-avis-bylaws.js";
import { subgraphForCity } from "../services/graph/graph-store.js";
import { snapshotFromExistingCity } from "../services/graph/graphify-34-snapshot.js";
import {
  captureCanonicalReadAnchor,
  readCanonicalCityGraph,
} from "../services/graph/canonical-graph-writer.js";

const store = {} as never;
const db = {} as never;

beforeEach(() => vi.clearAllMocks());

describe("loadCityGraph — source-swap --heal (PG) vs défaut (S3)", () => {
  it("--heal → lit PG (subgraphForCity + snapshotFromExistingCity), PAS S3 ; anchor = latest.json COURANT", async () => {
    vi.mocked(captureCanonicalReadAnchor).mockResolvedValue({
      city: "x",
      key: "graph/x/latest.json",
      etag: "etag-current",
      captured_at: "t",
    });
    vi.mocked(subgraphForCity).mockResolvedValue({ citySlug: "x", nodes: [{ id: "n1" }], edges: [] } as never);
    const pgGraph = { nodes: [{ id: "n1", type: "Bylaw", properties: {} }], edges: [] };
    vi.mocked(snapshotFromExistingCity).mockReturnValue(pgGraph as never);

    const result = await loadCityGraph({ heal: true, store, db, city: "x" });

    expect(subgraphForCity).toHaveBeenCalledWith(db, "x");
    expect(snapshotFromExistingCity).toHaveBeenCalledOnce();
    expect(captureCanonicalReadAnchor).toHaveBeenCalledWith(store, "x");
    expect(readCanonicalCityGraph).not.toHaveBeenCalled(); // PAS de lecture du contenu S3
    expect(result?.graph).toEqual(pgGraph);
    // ⚠ l'anchor vient du latest.json COURANT (write-guard concurrent), pas de PG.
    expect(result?.readAnchor.etag).toBe("etag-current");
  });

  it("défaut (pas --heal) → lit S3 latest.json (readCanonicalCityGraph), PAS PG", async () => {
    const body = new TextEncoder().encode(JSON.stringify({ nodes: [{ id: "n1" }], edges: [] }));
    vi.mocked(readCanonicalCityGraph).mockResolvedValue({
      body,
      anchor: { city: "x", key: "graph/x/latest.json", etag: "etag-s3", captured_at: "t" },
    } as never);

    const result = await loadCityGraph({ heal: false, store, db, city: "x" });

    expect(readCanonicalCityGraph).toHaveBeenCalledWith(store, "x");
    expect(subgraphForCity).not.toHaveBeenCalled(); // PAS de lecture PG
    expect(captureCanonicalReadAnchor).not.toHaveBeenCalled();
    expect(result?.graph).toEqual({ nodes: [{ id: "n1" }], edges: [] });
    expect(result?.readAnchor.etag).toBe("etag-s3");
  });

  it("--heal + PG vide (0 node) → null (ville ignorée, pas de snapshot)", async () => {
    vi.mocked(captureCanonicalReadAnchor).mockResolvedValue({ city: "x", key: "k", etag: null, captured_at: "t" });
    vi.mocked(subgraphForCity).mockResolvedValue({ citySlug: "x", nodes: [], edges: [] } as never);
    expect(await loadCityGraph({ heal: true, store, db, city: "x" })).toBeNull();
    expect(snapshotFromExistingCity).not.toHaveBeenCalled();
  });

  it("défaut + latest.json absent → null", async () => {
    vi.mocked(readCanonicalCityGraph).mockResolvedValue(null);
    expect(await loadCityGraph({ heal: false, store, db, city: "x" })).toBeNull();
  });
});
