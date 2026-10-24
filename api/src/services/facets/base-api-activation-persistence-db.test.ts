import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  facetEventBindings,
  facetEvents,
  facetHeads,
  facetStreams,
} from "../../db/schema.js";
import {
  activation,
  attach,
  describeDb,
  event,
  fixture,
  safety,
  type Fixture,
} from "./scope-db-fixture.js";
import { runPersonalAttachmentActivation } from "./activation-run.js";
import { verifyPersonalActivationPersistence } from "./activation-readback.js";
import { readScopedPersonalHeads } from "./scoped-reader.js";
import { executePersonalActivationResume } from "../../scripts/base-api-personal-activation.js";

/** Exercise the delivered operator coordinator against the damaged closed state. */
async function assertProtectedResumeClosed(f: Fixture) {
  const bound = { workspaceId: f.workspaceId, actorSub: f.actor.sub,
    maintenanceAttemptId: randomUUID(), releaseId: "synthetic-chain-release",
    instanceIds: ["synthetic-old"] };
  const proof = { completedAt: new Date().toISOString(), coveredInstanceIds: bound.instanceIds };
  const snapshot = async () => (await f.pool.query(`SELECT jsonb_agg(to_jsonb(a)) AS state
    FROM facet_activation_state a`)).rows;
  const before = await snapshot();
  await expect(executePersonalActivationResume(f.db, { workspaceId: f.workspaceId,
    actorSub: f.actor.sub, reason: "synthetic chain qualification", bound,
    evidence: { ...bound, reason: "synthetic chain qualification", drain: proof, shutdown: proof } }))
    .rejects.toMatchObject({ status: 503 });
  expect(await snapshot()).toEqual(before);
}

/** Bypass immutable-history guards only to simulate damaged disposable storage. */
async function corrupt(f: Fixture, query: string, params: unknown[]) {
  const client = await f.pool.connect();
  try {
    await client.query("BEGIN; SET LOCAL session_replication_role = replica");
    await client.query(query, params);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function persistedCounts(f: Fixture) {
  const one = async (query: string, params: unknown[]) =>
    ((await f.pool.query(query, params)).rows[0] as { n: number }).n;
  const scope: unknown[] = [f.workspaceId];
  return {
    streams: await one(`SELECT count(*)::int AS n FROM facet_streams WHERE workspace_id = $1`, scope),
    bindings: await one(`SELECT count(*)::int AS n FROM facet_event_bindings b
      JOIN facet_streams s ON s.id = b.stream_id WHERE s.workspace_id = $1`, scope),
    heads: await one(`SELECT count(*)::int AS n FROM facet_heads h
      JOIN facet_streams s ON s.id = h.stream_id WHERE s.workspace_id = $1`, scope),
    events: await one(`SELECT count(*)::int AS n FROM facet_events e WHERE e.id IN
      (SELECT b.event_id FROM facet_event_bindings b
       JOIN facet_streams s ON s.id = b.stream_id WHERE s.workspace_id = $1)`, scope),
  };
}

const populated = { streams: 1, bindings: 1, heads: 1 };
const empty = { streams: 0, bindings: 0, heads: 0 };
async function closedFixture(seeded = true) {
  const f = await fixture();
  if (seeded) await event(f);
  await attach(f);
  await expect(runPersonalAttachmentActivation(f.db, activation(f), { ...safety,
    readback: async () => { throw new Error("synthetic persistence pause"); },
  })).rejects.toThrow("synthetic persistence pause");
  return f;
}

describeDb("internal personal activation persistence", () => {
  it.each([true, false])("should verify seeded=%s without opening or changing SQL state", async (seeded) => {
    const f = await closedFixture(seeded);
    const expected = seeded ? populated : empty;
    const state = () => f.pool.query(`SELECT jsonb_build_object('activation',
      (SELECT jsonb_agg(a) FROM facet_activation_state a), 'streams',
      (SELECT jsonb_agg(s) FROM facet_streams s), 'bindings',
      (SELECT jsonb_agg(b) FROM facet_event_bindings b), 'heads',
      (SELECT jsonb_agg(h) FROM facet_heads h)) AS snapshot`);
    const before = (await state()).rows;
    await expect(verifyPersonalActivationPersistence(f.db, f.workspaceId.toUpperCase(), f.actor.sub, expected))
      .resolves.toEqual(expected);
    await expect(readScopedPersonalHeads(f.db, f.member.sub, f.workspaceId, "synthetic-city"))
      .rejects.toMatchObject({ status: 503 });
    expect((await state()).rows).toEqual(before);
    await expect(verifyPersonalActivationPersistence(f.db, f.otherId, f.actor.sub, expected))
      .rejects.toMatchObject({ status: 503, message: "activation_not_scoped" });
    await expect(verifyPersonalActivationPersistence(f.db, f.workspaceId, f.member.sub, expected))
      .rejects.toMatchObject({ status: 403 });
  });

  it.each([
    ["stream count", "SELECT 1", { ...populated, streams: 2 }, "activation_projection_mismatch"],
    ["binding count", "SELECT 1", { ...populated, bindings: 2 }, "activation_projection_mismatch"],
    ["head count", "SELECT 1", { ...populated, heads: 2 }, "activation_projection_mismatch"],
    ["undeclared empty", "SELECT 1", empty, "activation_projection_mismatch"],
    ["unbound history", "DELETE FROM facet_event_bindings", populated, "personal_history_unresolved"],
    ["missing projection", "DELETE FROM facet_heads", populated, "activation_projection_mismatch"],
    ["nonterminal head", "UPDATE facet_events SET superseded_by = gen_random_uuid()", populated, "activation_head_mismatch"],
    ["misattributed basket", "UPDATE facet_streams SET basket = 'a_surveiller'", populated, "activation_identity_mismatch"],
    ["misattributed city", "UPDATE facet_streams SET city_slug = 'foreign-city'", populated, "activation_identity_mismatch"],
    ["wrong scope", "UPDATE facet_streams SET scope = 'workspace', owner_id = NULL", populated, "activation_scope_mismatch"],
    ["foreign binding", "UPDATE facet_streams SET workspace_id = (SELECT id FROM workspaces WHERE id <> facet_streams.workspace_id LIMIT 1)", empty, "personal_history_unresolved"],
  ] as const)("should reject %s while keeping the barrier closed", async (_label, query, expected, message) => {
    const f = await closedFixture();
    // Simulate persisted corruption only in this disposable database; production guards stay intact.
    const client = await f.pool.connect();
    try {
      await client.query("BEGIN; SET LOCAL session_replication_role = replica");
      await client.query(query);
      await client.query("COMMIT");
    } finally { client.release(); }
    await expect(verifyPersonalActivationPersistence(f.db, f.workspaceId, f.actor.sub, expected))
      .rejects.toMatchObject({ status: 503, message });
    await expect(readScopedPersonalHeads(f.db, f.member.sub, f.workspaceId, "synthetic-city"))
      .rejects.toMatchObject({ status: 503 });
    expect((await f.pool.query("SELECT maintenance_barrier FROM facet_activation_state")).rows)
      .toEqual([{ maintenance_barrier: true }]);
  });

  it("should reject a misattributed owner without disclosing to the new owner", async () => {
    const f = await closedFixture();
    const client = await f.pool.connect();
    try {
      await client.query("BEGIN; SET LOCAL session_replication_role = replica");
      await client.query("UPDATE facet_streams SET owner_id = $1", [f.actor.id]);
      await client.query("COMMIT");
    } finally { client.release(); }
    await expect(verifyPersonalActivationPersistence(f.db, f.workspaceId, f.actor.sub, populated))
      .rejects.toMatchObject({ status: 503, message: "activation_identity_mismatch" });
    await expect(readScopedPersonalHeads(f.db, f.actor.sub, f.workspaceId, "synthetic-city"))
      .rejects.toMatchObject({ status: 503 });
    await expect(readScopedPersonalHeads(f.db, f.member.sub, f.workspaceId, "synthetic-city"))
      .rejects.toMatchObject({ status: 503 });
    expect((await f.pool.query("SELECT maintenance_barrier FROM facet_activation_state")).rows)
      .toEqual([{ maintenance_barrier: true }]);
  });

  it("should reject a cross-stream chain link at constant cardinality", async () => {
    const f = await fixture();
    const first = await event(f);
    const second = await event(f);
    await attach(f);
    await expect(runPersonalAttachmentActivation(f.db, activation(f), { ...safety,
      readback: async () => { throw new Error("synthetic persistence pause"); },
    })).rejects.toThrow("synthetic persistence pause");
    const client = await f.pool.connect();
    try {
      await client.query("BEGIN; SET LOCAL session_replication_role = replica");
      await client.query("UPDATE facet_events SET superseded_by = $1 WHERE id = $2",
        [second.id, first.id]);
      await client.query("COMMIT");
    } finally { client.release(); }
    await expect(verifyPersonalActivationPersistence(f.db, f.workspaceId, f.actor.sub,
      { streams: 2, bindings: 2, heads: 2 }))
      .rejects.toMatchObject({ status: 503, message: "activation_identity_mismatch" });
    await expect(readScopedPersonalHeads(f.db, f.member.sub, f.workspaceId, "synthetic-city"))
      .rejects.toMatchObject({ status: 503 });
    expect((await f.pool.query("SELECT maintenance_barrier FROM facet_activation_state")).rows)
      .toEqual([{ maintenance_barrier: true }]);
  });

  it("should reject a dangling chain link at constant cardinality", async () => {
    const f = await closedFixture();
    const before = await persistedCounts(f);
    const [bound] = (await f.pool.query(
      `SELECT b.event_id AS id FROM facet_event_bindings b
       JOIN facet_streams s ON s.id = b.stream_id WHERE s.workspace_id = $1 LIMIT 1`,
      [f.workspaceId])).rows as Array<{ id: string }>;
    await corrupt(f, `UPDATE facet_events SET supersedes = $1 WHERE id = $2`, [randomUUID(), bound!.id]);
    expect(await persistedCounts(f)).toEqual(before);
    await assertProtectedResumeClosed(f);
    await expect(verifyPersonalActivationPersistence(f.db, f.workspaceId, f.actor.sub, populated))
      .rejects.toMatchObject({ status: 503, message: "activation_identity_mismatch" });
    await expect(readScopedPersonalHeads(f.db, f.member.sub, f.workspaceId, "synthetic-city"))
      .rejects.toMatchObject({ status: 503 });
    expect((await f.pool.query("SELECT maintenance_barrier FROM facet_activation_state")).rows)
      .toEqual([{ maintenance_barrier: true }]);
  });

  it("should reject a link into another workspace", async () => {
    const f = await closedFixture();
    const nodeId = randomUUID();
    const foreignEvent = randomUUID();
    const foreignStream = randomUUID();
    const identity = { citySlug: "synthetic-city", nodeType: "Signal", nodeId,
      facet: "selection", basket: "pertinent" };
    await f.db.transaction(async (tx) => {
      await tx.insert(facetStreams).values({ id: foreignStream, workspaceId: f.otherId,
        scope: "personal", ownerId: f.actor.id, targetType: "signal", ...identity });
      await tx.insert(facetEvents).values({ id: foreignEvent, scope: "personal",
        ownerId: f.actor.id, actorId: f.actor.id, state: "active",
        observedFingerprint: "a".repeat(64), commandKey: randomUUID(),
        commandDigest: "b".repeat(64), ...identity });
      await tx.insert(facetEventBindings).values({ eventId: foreignEvent, streamId: foreignStream });
      await tx.insert(facetHeads).values({ streamId: foreignStream, eventId: foreignEvent });
    });
    const before = await persistedCounts(f);
    const [bound] = (await f.pool.query(
      `SELECT b.event_id AS id FROM facet_event_bindings b
       JOIN facet_streams s ON s.id = b.stream_id WHERE s.workspace_id = $1 LIMIT 1`,
      [f.workspaceId])).rows as Array<{ id: string }>;
    await corrupt(f, `UPDATE facet_events SET supersedes = $1 WHERE id = $2`,
      [foreignEvent, bound!.id]);
    expect(await persistedCounts(f)).toEqual(before);
    await assertProtectedResumeClosed(f);
    await expect(verifyPersonalActivationPersistence(f.db, f.workspaceId, f.actor.sub, populated))
      .rejects.toMatchObject({ status: 503, message: "activation_identity_mismatch" });
    await expect(readScopedPersonalHeads(f.db, f.member.sub, f.workspaceId, "synthetic-city"))
      .rejects.toMatchObject({ status: 503 });
    expect((await f.pool.query("SELECT maintenance_barrier FROM facet_activation_state")).rows)
      .toEqual([{ maintenance_barrier: true }]);
  });

});
