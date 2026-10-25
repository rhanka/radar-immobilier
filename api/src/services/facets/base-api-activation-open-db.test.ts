import { expect, it, vi } from "vitest";
import { activation, attach, describeDb, event, fixture, safety } from "./scope-db-fixture.js";
import { runPersonalAttachmentActivation } from "./activation-run.js";
import { resumePersonalAttachmentReadback } from "./activation-open.js";
import { authorizePersonalActivationReadback, verifyPersonalActivationPersistence } from "./activation-readback.js";
import { scopedEpochFor } from "./activation.js";
import { readScopedPersonalHeads } from "./scoped-reader.js";

type Fixture = Awaited<ReturnType<typeof fixture>>;
let seeded: Fixture | undefined;
async function closedFixture() {
  if (seeded) {
    // Reuse one seeded database within the runner's bounded PostgreSQL tmpfs.
    await seeded.pool.query("UPDATE account_users SET status = 'approved'");
    await seeded.pool.query(`UPDATE workspace_memberships SET status = 'active', revoked_at = NULL,
      manage_members = (account_id = $1)`, [seeded.actor.id]);
    await seeded.pool.query("UPDATE facet_activation_state SET maintenance_barrier = true");
    return seeded;
  }
  const f = await fixture();
  await event(f);
  await attach(f);
  await expect(runPersonalAttachmentActivation(f.db, activation(f), { ...safety,
    readback: async () => { throw new Error("synthetic pause before opening"); },
  })).rejects.toThrow("synthetic pause before opening");
  seeded = f;
  return f;
}
async function snapshot(f: Fixture) {
  return JSON.stringify(await Promise.all(["facet_activation_state", "facet_events", "facet_streams",
    "facet_event_bindings", "facet_heads"].map(async (table) =>
    (await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows)));
}
async function readback(f: Fixture) {
  await expect(authorizePersonalActivationReadback(f.db, f.workspaceId, f.actor.sub))
    .resolves.toMatchObject({ barrierClosed: true, attachedAccounts: 1 });
  await expect(verifyPersonalActivationPersistence(f.db, f.workspaceId, f.actor.sub,
    { streams: 1, bindings: 1, heads: 1 })).resolves.toEqual({ streams: 1, bindings: 1, heads: 1 });
  await expect(readScopedPersonalHeads(f.db, f.member.sub, f.workspaceId, "synthetic-city"))
    .rejects.toMatchObject({ status: 503 });
}

describeDb("personal activation final opening authority", () => {
  for (const stage of ["before resume", "after readback"] as const) {
    it.each([
      ["manager approval", "UPDATE account_users SET status = 'pending' WHERE id = $1", "actor", 403, "account_not_approved"],
      ["management capability", "UPDATE workspace_memberships SET manage_members = false WHERE account_id = $1", "actor", 403, "workspace_capability_required"],
      ["manager membership", "UPDATE workspace_memberships SET status = 'revoked', revoked_at = '2026-10-23T00:00:00Z' WHERE account_id = $1", "actor", 403, "workspace_capability_required"],
      ["attached approval", "UPDATE account_users SET status = 'pending' WHERE id = $1", "member", 403, "account_not_approved"],
      ["attached membership", "UPDATE workspace_memberships SET status = 'revoked', revoked_at = '2026-10-23T00:00:00Z' WHERE account_id = $1", "member", 403, "workspace_membership_required"],
      ["concurrent opening", "UPDATE facet_activation_state SET maintenance_barrier = false WHERE workspace_id = $1", "workspace", 409, "activation_already_open"],
    ] as const)(`should reject revoked %s ${stage} without an opening write`, async (_label, query, who, status, message) => {
      const f = await closedFixture();
      let before = "";
      const revoke = async () => {
        await f.pool.query(query, [who === "workspace" ? f.workspaceId : f[who].id]);
        before = await snapshot(f);
      };
      if (stage === "before resume") await revoke();
      const drain = vi.fn(safety.drain);
      const verify = vi.fn(async () => { await readback(f); await revoke(); });
      await expect(resumePersonalAttachmentReadback(f.db, activation(f), { drain, readback: verify }))
        .rejects.toMatchObject({ status, message });
      expect(await snapshot(f)).toBe(before);
      expect(drain).toHaveBeenCalledTimes(stage === "before resume" ? 0 : 1);
      expect(verify).toHaveBeenCalledTimes(stage === "before resume" ? 0 : 1);
      expect(await scopedEpochFor(f.db, f.workspaceId)).toBe(who === "workspace" ? "scoped" : null);
    });
  }

  it("should open only after real closed readback and preserve seeded history", async () => {
    const f = await closedFixture();
    const history = (await f.pool.query("SELECT to_jsonb(e) AS row FROM facet_events e ORDER BY id")).rows;
    await resumePersonalAttachmentReadback(f.db, activation(f), { ...safety, readback: () => readback(f) });
    expect(await scopedEpochFor(f.db, f.workspaceId)).toBe("scoped");
    expect(await readScopedPersonalHeads(f.db, f.member.sub, f.workspaceId, "synthetic-city")).toHaveLength(1);
    expect(await readScopedPersonalHeads(f.db, f.actor.sub, f.workspaceId, "synthetic-city")).toEqual([]);
    expect((await f.pool.query("SELECT to_jsonb(e) AS row FROM facet_events e ORDER BY id")).rows).toEqual(history);
  });

  it("should preserve the closed state and history after readback failure", async () => {
    const f = await closedFixture();
    const before = await snapshot(f);
    await expect(resumePersonalAttachmentReadback(f.db, activation(f), { ...safety,
      readback: async () => { await readback(f); throw new Error("synthetic readback failure"); },
    })).rejects.toThrow("synthetic readback failure");
    expect(await snapshot(f)).toBe(before);
    expect(await scopedEpochFor(f.db, f.workspaceId)).toBeNull();
  });
});
