/** B4 behavioral mutation witnesses against real protected operator composition. */
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { executePersonalActivationResume, type PersonalActivationCommand } from "../../src/scripts/base-api-personal-activation.js";
import * as readback from "../../src/services/facets/activation-readback.js";
import { runPersonalAttachmentActivation } from "../../src/services/facets/activation-run.js";
import { readDurableLegacyRetirement } from "../../src/services/facets/legacy-retirement.js";
import { readScopedPersonalHeads } from "../../src/services/facets/scoped-reader.js";
import { activation, attach, describeDb, event, fixture, safety, type Fixture } from "../../src/services/facets/scope-db-fixture.js";
import { httpFixture } from "./base-api-http-fixture.js";

afterEach(() => vi.restoreAllMocks());
function command(f: Fixture): PersonalActivationCommand {
  const bound = { workspaceId: f.workspaceId, actorSub: f.actor.sub,
    maintenanceAttemptId: randomUUID(), releaseId: "synthetic-b4-mutations", instanceIds: ["synthetic-old"] };
  const proof = { completedAt: new Date().toISOString(), coveredInstanceIds: bound.instanceIds };
  return { workspaceId: f.workspaceId, actorSub: f.actor.sub, reason: "synthetic mutation qualification",
    bound, evidence: { ...bound, reason: "synthetic mutation qualification", drain: proof, shutdown: proof } };
}
async function prepared() {
  const f = await fixture();
  await event(f); await attach(f);
  // Seed a real committed scoped history; the deliberate setup pause is not a safety proof.
  await runPersonalAttachmentActivation(f.db, activation(f), { ...safety,
    readback: async () => { throw new Error("synthetic fixture pause"); },
  }).catch(() => undefined);
  expect((await f.pool.query("SELECT writer_epoch FROM facet_activation_state")).rows)
    .toEqual([{ writer_epoch: "scoped" }]);
  await f.pool.query("UPDATE facet_activation_state SET maintenance_barrier = true");
  return f;
}
async function snapshot(f: Fixture) {
  return JSON.stringify(await Promise.all(["facet_activation_state", "facet_events", "facet_streams",
    "facet_event_bindings", "facet_heads"].map(async (table) =>
    (await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows)));
}
async function closedState(f: Fixture) {
  return {
    state: (await f.pool.query("SELECT writer_epoch, maintenance_barrier FROM facet_activation_state")).rows,
    publicStatus: await readScopedPersonalHeads(f.db, f.member.sub, f.workspaceId, "synthetic-city")
      .then(() => 200, (error: { status: number }) => error.status),
  };
}
const closed = { state: [{ writer_epoch: "scoped", maintenance_barrier: true }], publicStatus: 503 };
const status = (task: Promise<unknown>) => task.then(() => 200, (error: { status: number }) => error.status);

describeDb("B4 integrated mutation closure", () => {
  it.each(["drain", "shutdown", "workspaceId", "maintenanceAttemptId", "releaseId"])(
    "should retain closed SQL and public state for invalid %s evidence", async (key) => {
      const f = await prepared(); const input = command(f);
      (input.evidence as Record<string, unknown>)[key] = ["drain", "shutdown"].includes(key)
        ? undefined : key === "releaseId" ? "another-release" : randomUUID();
      const before = await snapshot(f);
      const observed = { status: await status(executePersonalActivationResume(f.db, input)),
        sql: await snapshot(f), publicState: await closedState(f) };
      expect(observed).toEqual({ status: key === "drain" || key === "shutdown" ? 503 : 403,
        sql: before, publicState: closed });
    });

  it("should reject seeded persisted corruption through real operator readback", async () => {
    const f = await prepared(); const client = await f.pool.connect();
    try { await client.query("BEGIN; SET LOCAL session_replication_role = replica; DELETE FROM facet_heads; COMMIT"); }
    finally { client.release(); }
    const before = await snapshot(f);
    expect(await status(executePersonalActivationResume(f.db, command(f)))).toBe(503);
    expect(await snapshot(f)).toBe(before); expect(await closedState(f)).toEqual(closed);
  });

  it("should keep durable and public barriers closed throughout scoped resume readback", async () => {
    const f = await prepared(); const history = (await f.pool.query("SELECT * FROM facet_events ORDER BY id")).rows;
    const verify = readback.authorizePersonalActivationReadback;
    const observed: Awaited<ReturnType<typeof closedState>>[] = [];
    vi.spyOn(readback, "authorizePersonalActivationReadback").mockImplementation(async (...args) => {
      observed.push(await closedState(f)); return verify(...args);
    });
    const result = await executePersonalActivationResume(f.db, command(f)).then((r) => r.status, () => "rejected");
    expect(observed).toEqual([closed]);
    expect(result).toBe("open-success");
    expect((await f.pool.query("SELECT * FROM facet_events ORDER BY id")).rows).toEqual(history);
    expect(await readScopedPersonalHeads(f.db, f.member.sub, f.workspaceId, "synthetic-city")).toHaveLength(1);
  });

  it("should recheck current manager authority after real readback before opening", async () => {
    const f = await prepared(); const verify = readback.verifyPersonalActivationPersistence;
    vi.spyOn(readback, "verifyPersonalActivationPersistence").mockImplementation(async (...args) => {
      const result = await verify(...args);
      await f.pool.query("UPDATE account_users SET status = 'pending' WHERE id = $1", [f.actor.id]);
      return result;
    });
    expect(await status(executePersonalActivationResume(f.db, command(f)))).toBe(403);
    expect(await closedState(f)).toEqual(closed);
  });

  it("should retain durable 503 and 410 across app reconstruction", async () => {
    const f = await prepared();
    for (const expected of [503, 410]) {
      const app = await httpFixture(await readDurableLegacyRetirement(f.db));
      expect((await app.request("/api/v1/signal-facets/reason-codes")).status).toBe(expected);
      expect((await app.request("/api/graph-signals/by-city")).status).toBe(expected);
      if (expected === 503) await executePersonalActivationResume(f.db, command(f));
    }
  });
});
