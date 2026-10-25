// 6K readback: head, binding, stream and event identities must agree.
// A swapped head or a renamed stream keeps cardinalities constant but must
// fail closed before any comparison with the qualified manifest.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { lotCutoverState } from "../../../db/schema.js";
import { readLotCutoverReadback } from "./lot-cutover-readback.js";
import { expectedCutoverHeadValues } from "./lot-cutover-expectations.js";
import { readLotCity } from "./lot-city.js";
import {
  evaluateActivationGate,
  runLotCutover,
} from "./lot-cutover.js";
import { qualifiedLotCutoverSafety } from "./lot-cutover-safety.js";
import { ScopeError } from "../scope.js";
import {
  CUTOVER_CITY,
  cleanCutoverReport,
  cutoverFixture,
  describeDb,
  type CutoverFixture,
} from "./cutover-fixture.js";

/** Server-supplied binding plus fresh qualified maintenance evidence. */
function boundEvidence(f: CutoverFixture) {
  const bound = { workspaceId: f.workspaceId, actorSub: f.moderator.sub,
    maintenanceAttemptId: randomUUID(), releaseId: "synthetic-identity-release",
    instanceIds: ["synthetic-old-a", "synthetic-old-b"] };
  const proof = { completedAt: new Date().toISOString(), coveredInstanceIds: bound.instanceIds };
  return { bound, evidence: { ...bound, reason: "synthetic identity proof", drain: proof, shutdown: proof } };
}

/** Bypass immutable-history guards only to simulate damaged disposable storage. */
async function corrupt(f: CutoverFixture, query: string | string[], params: unknown[]) {
  const client = await f.pool.connect();
  try {
    await client.query("BEGIN; SET LOCAL session_replication_role = replica");
    for (const statement of typeof query === "string" ? [query] : query) {
      await client.query(statement, params);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function persistedCounts(f: CutoverFixture) {
  const one = async (query: string) =>
    ((await f.pool.query(query, [f.workspaceId])).rows[0] as { n: number }).n;
  return {
    streams: await one(`SELECT count(*)::int AS n FROM facet_streams WHERE workspace_id = $1`),
    bindings: await one(`SELECT count(*)::int AS n FROM facet_event_bindings b
      JOIN facet_streams s ON s.id = b.stream_id WHERE s.workspace_id = $1`),
    heads: await one(`SELECT count(*)::int AS n FROM facet_heads h
      JOIN facet_streams s ON s.id = h.stream_id WHERE s.workspace_id = $1`),
    events: await one(`SELECT count(*)::int AS n FROM facet_events e WHERE e.id IN
      (SELECT b.event_id FROM facet_event_bindings b
       JOIN facet_streams s ON s.id = b.stream_id WHERE s.workspace_id = $1)`),
  };
}

/** Reconciled but still closed: first run interrupted at readback, resume reuses its key. */
async function reconciled() {
  const f = await cutoverFixture();
  const { report } = cleanCutoverReport();
  const gate = await evaluateActivationGate(f.db, f.workspaceId, report);
  expect(gate.activatable).toBe(true);
  const input = { workspaceId: f.workspaceId, actorSub: f.moderator.sub, report,
    importKey: randomUUID(), confirmCutover: true as const, recomputeManifest: async () => report };
  const { bound, evidence } = boundEvidence(f);
  const failing = qualifiedLotCutoverSafety(f.db, bound, evidence, gate.ready,
    { expectedCutoverHeads: expectedCutoverHeadValues(report, gate.activatedSourceIds) });
  failing.readbackAuthorized = async () => {
    throw new ScopeError(503, "lot_cutover_readback_unconfirmed");
  };
  await expect(runLotCutover(f.db, input, failing)).rejects.toMatchObject({ status: 503 });
  return { f, report, gate, input, bound, evidence };
}

async function assertClosedResume(f: CutoverFixture) {
  const [state] = await f.db.select().from(lotCutoverState)
    .where(eq(lotCutoverState.workspaceId, f.workspaceId));
  expect(state).toMatchObject({ maintenanceBarrier: true, destinationOpen: false });
  await expect(readLotCity(f.db, f.moderator.sub, f.workspaceId, "real", CUTOVER_CITY))
    .rejects.toMatchObject({ status: 503 });
}

describeDb("6K readback stream and event identity", () => {
  it("should refuse permuted head references between two lots", async () => {
    const { f, report, gate, input, bound, evidence } = await reconciled();
    const before = await persistedCounts(f);
    const heads = (await f.pool.query(
      `SELECT h.stream_id AS "streamId", h.event_id AS "eventId", s.node_id AS "nodeId" FROM facet_heads h
       JOIN facet_streams s ON s.id = h.stream_id
       WHERE s.workspace_id = $1 ORDER BY s.node_id, s.facet`, [f.workspaceId])).rows as
      Array<{ streamId: string; eventId: string; nodeId: string }>;
    expect(heads.length).toBeGreaterThanOrEqual(2);
    const first = heads[0]!;
    const second = heads.find((head) => head.nodeId !== first.nodeId)!;
    expect(second).toBeDefined();
    // Replace both references atomically without transiently violating event uniqueness.
    await corrupt(f, [
      `DELETE FROM facet_heads WHERE (stream_id = $1 AND event_id = $3)
        OR (stream_id = $2 AND event_id = $4)`,
      `INSERT INTO facet_heads (stream_id, event_id) VALUES ($1, $4), ($2, $3)`,
    ],
      [first.streamId, second.streamId, first.eventId, second.eventId]);
    expect(await persistedCounts(f)).toEqual(before);
    const safety = qualifiedLotCutoverSafety(f.db, bound, evidence, gate.ready,
      { expectedCutoverHeads: expectedCutoverHeadValues(report, gate.activatedSourceIds) });
    const observed = await runLotCutover(f.db, input, safety)
      .then(() => 200, (error: { status: number }) => error.status);
    expect(observed).toBe(503);
    await assertClosedResume(f);
    await expect(readLotCutoverReadback(f.db, f.moderator.sub, f.workspaceId, "real", CUTOVER_CITY))
      .rejects.toMatchObject({ status: 503, message: "lot_cutover_identity_mismatch" });
  });

  it("should refuse a stream renamed to another lot", async () => {
    const { f, report, gate, input, bound, evidence } = await reconciled();
    const before = await persistedCounts(f);
    const streams = (await f.pool.query(
      `SELECT id, node_id AS "nodeId" FROM facet_streams
       WHERE workspace_id = $1 AND target_type = 'lot' ORDER BY node_id, facet`, [f.workspaceId])).rows as
      Array<{ id: string; nodeId: string }>;
    const first = streams[0]!;
    const target = streams.find((stream) => stream.nodeId !== first.nodeId);
    expect(target).toBeDefined();
    await corrupt(f, `UPDATE facet_streams SET node_id = $2 WHERE id = $1`, [first.id, target!.nodeId]);
    expect(await persistedCounts(f)).toEqual(before);
    const safety = qualifiedLotCutoverSafety(f.db, bound, evidence, gate.ready,
      { expectedCutoverHeads: expectedCutoverHeadValues(report, gate.activatedSourceIds) });
    const observed = await runLotCutover(f.db, input, safety)
      .then(() => 200, (error: { status: number }) => error.status);
    expect(observed).toBe(503);
    await assertClosedResume(f);
    await expect(readLotCutoverReadback(f.db, f.moderator.sub, f.workspaceId, "real", CUTOVER_CITY))
      .rejects.toMatchObject({ status: 503, message: "lot_cutover_identity_mismatch" });
  });
});
