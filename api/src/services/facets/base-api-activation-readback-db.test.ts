import { expect, it } from "vitest";
import { activation, attach, describeDb, event, fixture, safety } from "./scope-db-fixture.js";
import { runPersonalAttachmentActivation } from "./activation-run.js";
import { authorizePersonalActivationReadback } from "./activation-readback.js";
import { readScopedPersonalHeads } from "./scoped-reader.js";

async function closedFixture(mode = "scoped") {
  const f = await fixture();
  await event(f);
  await attach(f);
  if (mode === "missing state") return f;
  // Pause the real runner before/after epoch commit; qualify authorization only.
  const pause = async () => { throw new Error("synthetic readback pause"); };
  await expect(runPersonalAttachmentActivation(f.db, activation(f), { ...safety,
    ...(mode === "legacy epoch" ? { drain: pause } : { readback: pause }),
  })).rejects.toThrow("synthetic readback pause");
  return f;
}

describeDb("internal personal activation readback authority", () => {
  it("should return bounded evidence while retaining the durable public barrier", async () => {
    const f = await closedFixture();
    const state = () => f.pool.query("SELECT * FROM facet_activation_state ORDER BY workspace_id");
    const before = JSON.stringify((await state()).rows);
    await expect(authorizePersonalActivationReadback(f.db, f.workspaceId.toUpperCase(), f.actor.sub))
      .resolves.toEqual({ workspaceId: f.workspaceId.toUpperCase(), epoch: "scoped",
        barrierClosed: true, attachedAccounts: 1, activeMemberships: 1 });
    await expect(readScopedPersonalHeads(f.db, f.member.sub, f.workspaceId, "synthetic-city"))
      .rejects.toMatchObject({ status: 503 });
    expect(JSON.stringify((await state()).rows)).toBe(before);
    await expect(authorizePersonalActivationReadback(f.db, f.otherId, f.actor.sub))
      .rejects.toMatchObject({ status: 503, message: "activation_not_scoped" });
    await expect(authorizePersonalActivationReadback(f.db, f.workspaceId, f.member.sub))
      .rejects.toMatchObject({ status: 403, message: "workspace_capability_required" });
  });

  it.each([
    ["missing state", "SELECT 1", 503, "activation_not_scoped"],
    ["legacy epoch", "SELECT 1", 409, "activation_not_scoped"],
    ["open barrier", "UPDATE facet_activation_state SET maintenance_barrier = false", 409, "activation_already_open"],
    ["foreign attachment", "INSERT INTO facet_activation_state (workspace_id, maintenance_barrier) VALUES ($3, true)", 409, "activation_without_attachment"],
    ["revoked manager approval", "UPDATE account_users SET status = 'pending' WHERE id = $1", 403, "account_not_approved"],
    ["revoked management", "UPDATE workspace_memberships SET manage_members = false WHERE account_id = $1", 403, "workspace_capability_required"],
    ["revoked manager membership", "UPDATE workspace_memberships SET status = 'revoked', revoked_at = '2026-10-23T00:00:00Z' WHERE account_id = $1", 403, "workspace_capability_required"],
    ["revoked attached approval", "UPDATE account_users SET status = 'pending' WHERE id = $2", 403, "account_not_approved"],
    ["revoked attached membership", "UPDATE workspace_memberships SET status = 'revoked', revoked_at = '2026-10-23T00:00:00Z' WHERE account_id = $2", 403, "workspace_membership_required"],
    ["missing attached membership", "DELETE FROM workspace_memberships WHERE account_id = $2", 403, "workspace_membership_required"],
    ["covering ambiguity", `INSERT INTO facet_stream_attachments
      (account_id, workspace_id, status, detail, actor_id, reason)
      VALUES ($1, $3, 'pending-ambiguous', jsonb_build_object('ids', jsonb_build_array($4::text, $3::text)), $1, 'synthetic ambiguity')`, 503, "personal_history_unresolved"],
  ] as const)("should reject %s without mutating activation state", async (_label, query, status, message) => {
    const f = await closedFixture(_label);
    const workspaceId = _label === "foreign attachment" ? f.otherId : f.workspaceId;
    const values = [f.actor.id, f.member.id, f.otherId, f.workspaceId];
    const count = Math.max(0, ...[...query.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])));
    // Cast unused positional inputs so PostgreSQL can infer every parameter.
    const prefix = values.slice(0, count).map((_, i) => `$${i + 1}::uuid`).join(", ");
    await f.pool.query(`WITH synthetic_inputs AS (SELECT ${prefix || "1"}) ${query}`, values.slice(0, count));
    if (_label === "foreign attachment")
      await f.pool.query("SELECT facet_swap_head_enforcement($1)", [workspaceId]);
    const before = (await f.pool.query("SELECT * FROM facet_activation_state")).rows;
    await expect(authorizePersonalActivationReadback(f.db, workspaceId, f.actor.sub))
      .rejects.toMatchObject({ status, message });
    expect((await f.pool.query("SELECT * FROM facet_activation_state")).rows).toEqual(before);
  });
});
