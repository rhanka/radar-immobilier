import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Database } from "../../src/db/client.js";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { baseState } from "../../src/services/facets/signal-write-fixture.js";
import { prepareCityProjection, projectCityInTransaction, upsertGraph, upsertGraphAtomic } from "../../src/services/graph/graph-store.js";
import { backendPid, blockedBy, effects, latch, NO_EFFECTS, ONE_COMMIT, outcome, writeFixture } from "./pwe-fixture.js";
import { holdTransaction } from "./pwe-revision-fixture.js";

const kinds = ["freshness", "projection", "repair"] as const;
async function importer(kind: typeof kinds[number]) {
  const h = await writeFixture();
  const nodes = (await h.f.pool.query("SELECT id,type,label FROM graph_nodes WHERE city_slug=$1", [h.row.citySlug])).rows;
  const graph = { nodes: [...nodes, { id: randomUUID(), type: "Signal", label: "Synthetic imported source" }], links: [] };
  const mutate = async (db: Database = h.f.db) => {
    if (kind === "freshness") return upsertGraph(db, h.row.citySlug, graph);
    const result = kind === "projection" ? await upsertGraphAtomic(db, h.row.citySlug, graph)
      : await db.transaction((tx) => projectCityInTransaction(tx, prepareCityProjection(h.row.citySlug, graph)));
    expect(result.aborted).toBe(false);
    return result;
  };
  return { ...h, mutate };
}

describeDb("PWE-05 C04 C05 source importer lock coverage", () => {
  it.each(kinds)("should compare a fresh snapshot after waiting for the %s importer commit", async (kind) => {
    const h = await importer(kind);
    const before = await baseState(h.f);
    const held = holdTransaction(h.f.db);
    const mutation = outcome(h.mutate(held.db));
    let confirmation: ReturnType<typeof outcome> | undefined;
    try {
      await held.reached.wait();
      confirmation = outcome(h.execute());
      await blockedBy(h.f, held.pid());
    } finally { held.release.resolve(); }
    expect((await mutation).error).toBeNull();
    expect((await confirmation)?.error).toMatchObject({ status: 409, message: "projection_revision_conflict" });
    expect(await baseState(h.f)).toEqual(before);
    expect(await effects(h.f)).toEqual(NO_EFFECTS);
  });

  it.each(kinds)("should keep the %s importer behind an admitted confirmation until commit", async (kind) => {
    const h = await importer(kind);
    const reached = latch(); const release = latch();
    const port = h.admission(); const record = port.recordCommit;
    let pid = 0;
    port.recordCommit = async (tx, result) => {
      await record(tx, result); pid = await backendPid(tx); reached.resolve(); await release.promise;
    };
    const confirmation = outcome(h.execute(port));
    let mutation: ReturnType<typeof outcome> | undefined;
    try {
      await reached.wait();
      mutation = outcome(h.mutate());
      await blockedBy(h.f, pid);
      expect(await effects(h.f)).toEqual(NO_EFFECTS);
    } finally { release.resolve(); }
    expect((await confirmation).error).toBeNull();
    expect((await mutation)?.error).toBeNull();
    expect(await effects(h.f)).toEqual(ONE_COMMIT);
  });
});
