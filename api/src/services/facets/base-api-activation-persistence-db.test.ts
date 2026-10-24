import { expect, it } from "vitest";
import { activation, attach, describeDb, event, fixture, safety } from "./scope-db-fixture.js";
import { runPersonalAttachmentActivation } from "./activation-run.js";
import { verifyPersonalActivationPersistence } from "./activation-readback.js";
import { readScopedPersonalHeads } from "./scoped-reader.js";

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
});
