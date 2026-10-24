import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { executePersonalActivation, executePersonalActivationResume, type PersonalActivationCommand } from "../../scripts/base-api-personal-activation.js";
import * as readback from "./activation-readback.js";
import { attach, describeDb, event, fixture, type Fixture } from "./scope-db-fixture.js";
import { readScopedPersonalHeads } from "./scoped-reader.js";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-23T12:00:00Z")); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
function command(f: Fixture): PersonalActivationCommand {
  const bound = { workspaceId: f.workspaceId, actorSub: f.actor.sub,
    maintenanceAttemptId: "00000000-0000-0000-0000-000000000007", releaseId: "synthetic-resume", instanceIds: ["synthetic-old"] };
  const proof = { completedAt: "2026-10-23T11:59:00Z", coveredInstanceIds: bound.instanceIds };
  return { workspaceId: f.workspaceId, actorSub: f.actor.sub, reason: "synthetic protected resume", bound,
    evidence: { ...bound, reason: "synthetic protected resume", drain: proof, shutdown: proof } };
}
async function seeded() {
  const f = await fixture();
  await event(f, { createdAt: new Date("2026-10-23T11:00:00Z") });
  await attach(f);
  return f;
}
async function closed(f: Fixture) {
  const authorize = readback.authorizePersonalActivationReadback;
  const spy = vi.spyOn(readback, "authorizePersonalActivationReadback").mockImplementationOnce(async (...args) => {
    await authorize(...args); throw new Error("synthetic interruption after epoch commit");
  });
  await expect(executePersonalActivation(f.db, command(f))).rejects.toThrow("synthetic interruption");
  spy.mockRestore();
}
let shared: Fixture | undefined;
async function scopedFixture() {
  if (!shared) { shared = await seeded(); await closed(shared); }
  else {
    // Reuse the scoped fixture within the campaign's bounded PostgreSQL tmpfs.
    await shared.pool.query("UPDATE account_users SET status = 'approved'");
    await shared.pool.query("UPDATE workspace_memberships SET status = 'active', revoked_at = NULL");
    await shared.pool.query("UPDATE facet_activation_state SET maintenance_barrier = true");
  }
  return shared;
}
async function snapshot(f: Fixture) {
  const { rows } = await f.pool.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  return JSON.stringify(await Promise.all(rows.map(async ({ tablename }) => {
    const identifier = tablename.replaceAll('"', '""');
    return (await f.pool.query(`SELECT to_jsonb(t) AS row FROM "${identifier}" t ORDER BY to_jsonb(t)::text`)).rows;
  })));
}
async function assertClosed(f: Fixture, readerSub = f.member.sub) {
  expect((await f.pool.query("SELECT writer_epoch, maintenance_barrier FROM facet_activation_state WHERE workspace_id = $1", [f.workspaceId])).rows)
    .toEqual([{ writer_epoch: "scoped", maintenance_barrier: true }]);
  await expect(readScopedPersonalHeads(f.db, readerSub, f.workspaceId, "synthetic-city")).rejects.toMatchObject({ status: 503 });
}

describeDb("personal activation durable operator resume", () => {
  it.each([false, true])("should resume protected activation with existing legacy barrier %s", async (legacy) => {
    const f = await seeded();
    if (legacy) await f.pool.query("INSERT INTO facet_activation_state (workspace_id, writer_epoch, maintenance_barrier, old_index_dropped) VALUES ($1, 'legacy', true, false)", [f.workspaceId]);
    await expect(executePersonalActivationResume(f.db, command(f))).resolves.toMatchObject({ status: "open-success", epoch: "scoped", streamsBound: 1 });
  });

  it("should resume scoped readback without rebinding history and keep public readers closed until opening", async () => {
    const f = await scopedFixture(); await assertClosed(f);
    const history = (await f.pool.query("SELECT * FROM facet_events ORDER BY id")).rows;
    const bindings = (await f.pool.query("SELECT * FROM facet_event_bindings ORDER BY event_id")).rows;
    const verify = readback.verifyPersonalActivationPersistence;
    const spy = vi.spyOn(readback, "verifyPersonalActivationPersistence").mockImplementation(async (...args) => {
      await assertClosed(f); return verify(...args);
    });
    await expect(executePersonalActivationResume(f.db, command(f))).resolves.toMatchObject({ status: "open-success", streamsBound: 1, maintenanceBarrier: false });
    expect(spy).toHaveBeenCalledOnce();
    expect((await f.pool.query("SELECT * FROM facet_events ORDER BY id")).rows).toEqual(history);
    expect((await f.pool.query("SELECT * FROM facet_event_bindings ORDER BY event_id")).rows).toEqual(bindings);
    await expect(readScopedPersonalHeads(f.db, f.member.sub, f.workspaceId, "synthetic-city")).resolves.toHaveLength(1);
    await expect(readScopedPersonalHeads(f.db, f.actor.sub, f.workspaceId, "synthetic-city")).resolves.toEqual([]);
    await expect(readScopedPersonalHeads(f.db, f.member.sub, f.otherId, "synthetic-city")).rejects.toMatchObject({ status: 503 });
  });

  it("should reject persisted mismatch then resume only after its protected correction", async () => {
    const f = await scopedFixture();
    const client = await f.pool.connect();
    let heads;
    try {
      await client.query("BEGIN; SET LOCAL session_replication_role = replica");
      heads = (await client.query("DELETE FROM facet_heads RETURNING *")).rows;
      await client.query("COMMIT");
    } finally { client.release(); }
    await expect(executePersonalActivationResume(f.db, command(f))).rejects.toMatchObject({ status: 503, message: "activation_projection_mismatch" });
    await assertClosed(f);
    for (const head of heads) await f.pool.query("INSERT INTO facet_heads SELECT * FROM jsonb_populate_record(NULL::facet_heads, $1::jsonb)", [JSON.stringify(head)]);
    await expect(executePersonalActivationResume(f.db, command(f))).resolves.toMatchObject({ status: "open-success", streamsBound: 1 });
  });

  it.each(["drain", "shutdown", "workspaceId", "maintenanceAttemptId", "releaseId"])("should reject invalid %s evidence without writes", async (key) => {
    const f = await scopedFixture();
    const input = command(f);
    (input.evidence as Record<string, unknown>)[key] = key === "drain" || key === "shutdown" ? undefined : "another";
    const before = await snapshot(f);
    await expect(executePersonalActivationResume(f.db, input)).rejects.toThrow();
    expect(await snapshot(f)).toBe(before); await assertClosed(f);
  });

  it.each([false, true])("should return already-open seeded or empty status without any SQL mutation: empty=%s", async (empty) => {
    const f = empty ? await fixture() : await seeded();
    if (empty) await attach(f);
    await executePersonalActivation(f.db, command(f));
    const before = await snapshot(f);
    await expect(executePersonalActivationResume(f.db, command(f))).resolves.toMatchObject({ status: "open-success", streamsBound: empty ? 0 : 1 });
    expect(await snapshot(f)).toBe(before);
  });

  it.each([
    [false, "manager-approval"], [false, "manager-membership"], [false, "attached-approval"], [false, "attached-membership"],
    [true, "manager-approval"], [true, "manager-membership"], [true, "attached-approval"], [true, "attached-membership"],
  ] as const)("should reject revoked rights without writes: open=%s, right=%s", async (open, right) => {
    const f = await scopedFixture();
    if (open) await executePersonalActivationResume(f.db, command(f));
    const account = right.startsWith("manager") ? f.actor.id : f.member.id;
    if (right.endsWith("approval")) await f.pool.query("UPDATE account_users SET status = 'pending' WHERE id = $1", [account]);
    else await f.pool.query("UPDATE workspace_memberships SET status = 'revoked', revoked_at = '2026-10-23T12:00:00Z' WHERE workspace_id = $1 AND account_id = $2", [f.workspaceId, account]);
    const before = await snapshot(f);
    await expect(executePersonalActivationResume(f.db, command(f))).rejects.toMatchObject({ status: 403 });
    expect(await snapshot(f)).toBe(before);
    if (!open) await assertClosed(f, right.startsWith("attached") ? f.actor.sub : f.member.sub);
  });

  it("should reject unresolved scoped history without replaying activation", async () => {
    const f = await seeded();
    const parent = (await f.pool.query<{ id: string }>("SELECT id FROM facet_events")).rows[0]!;
    await event(f, { supersedes: parent.id, createdAt: new Date("2026-10-23T11:01:00Z") });
    await executePersonalActivation(f.db, command(f));
    const before = await snapshot(f);
    await expect(executePersonalActivationResume(f.db, command(f))).rejects.toMatchObject({ status: 503, message: "personal_history_unresolved" });
    expect(await snapshot(f)).toBe(before); await assertClosed(f);
  });
});
