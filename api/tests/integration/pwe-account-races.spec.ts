import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import type { Database } from "../../src/db/client.js";
import { describeDb, workspaceFixture } from "../../src/services/facets/workspace-archive-fixture.js";
import { preparedSelect } from "../../src/services/facets/signal-write-fixture.js";
import { pwPrepared, pwConfirmation } from "../../src/services/facets/pw-write-fixture.js";
import { coordinateSignalWrite } from "../../src/services/facets/signal-write-admission.js";
import { createDurableWriteAdmission } from "../../src/services/facets/pw-write-admission-durable.js";
import { revokeMembership } from "../../src/services/workspaces/mutations.js";
import { setMembershipCapability } from "../../src/services/workspaces/capabilities.js";
import { backendPid, blockedBy, effects, latch, NO_EFFECTS, outcome } from "./pwe-fixture.js";
import { holdTransaction } from "./pwe-revision-fixture.js";

type Kind = "approval" | "membership" | "moderation";
async function accountFixture(kind: Kind) {
  const f = await workspaceFixture();
  if (kind === "moderation") await f.pool.query(`UPDATE workspace_memberships SET moderate_archive=true,
    revision=revision+1 WHERE workspace_id=$1 AND account_id=$2`, [f.workspaceId, f.contributor.id]);
  const input = await preparedSelect(f);
  if (kind === "moderation") {
    input.operation = "facets.signals.workspace.discard.v1"; delete input.basket; input.reasonCode = "N-NON-RES";
  }
  const row = await pwPrepared(f, input);
  const admission = () => createDurableWriteAdmission(row.intentId, { confirmation: pwConfirmation(row) });
  const execute = (port = admission()) => coordinateSignalWrite(f.db, f.contributor.sub, input, port);
  const membership = (await f.pool.query("SELECT revision FROM workspace_memberships WHERE workspace_id=$1 AND account_id=$2",
    [f.workspaceId, f.contributor.id])).rows[0];
  const mutation = { workspaceId: f.workspaceId, targetAccountId: f.contributor.id,
    actorSub: f.moderator.sub, reason: "Synthetic PWE withdrawal", expectedRevision: membership.revision as number };
  const withdraw = async (db: Database = f.db) => {
    if (kind === "membership") return revokeMembership(db, mutation);
    if (kind === "moderation") return setMembershipCapability(db,
      { ...mutation, capability: "moderate_archive", granted: false });
    return db.transaction((tx) => tx.execute(sql`UPDATE account_users SET status='suspended' WHERE id=${f.contributor.id}`));
  };
  return { f, row, admission, execute, withdraw };
}

describeDb("PWE-06 C03 account and workspace withdrawal", () => {
  it.each(["approval", "membership", "moderation"] as const)(
    "should refuse confirmation after %s withdrawal commits first", async (kind) => {
      const h = await accountFixture(kind);
      const held = holdTransaction(h.f.db);
      const withdrawal = outcome(h.withdraw(held.db));
      let confirmation: ReturnType<typeof outcome> | undefined;
      try {
        await held.reached.wait();
        confirmation = outcome(h.execute());
        await blockedBy(h.f, held.pid());
      } finally { held.release.resolve(); }
      expect((await withdrawal).error).toBeNull();
      expect((await confirmation)?.error).toMatchObject({ status: 403, message: {
        approval: "account_not_approved", membership: "workspace_membership_required",
        moderation: "workspace_capability_required" }[kind] });
      expect(await effects(h.f)).toEqual(NO_EFFECTS);
    });

  it.each(["approval", "membership", "moderation"] as const)(
    "should make %s withdrawal wait for an admitted confirmation", async (kind) => {
      const h = await accountFixture(kind);
      const reached = latch(); const release = latch();
      const port = h.admission(); const record = port.recordCommit;
      let pid = 0; let acknowledged = false;
      port.recordCommit = async (tx, result) => {
        await record(tx, result); pid = await backendPid(tx); reached.resolve(); await release.promise;
      };
      const confirmation = outcome(h.execute(port));
      let withdrawal: ReturnType<typeof outcome> | undefined;
      try {
        await reached.wait();
        withdrawal = outcome(h.withdraw()).then((result) => { acknowledged = true; return result; });
        await blockedBy(h.f, pid);
        expect(acknowledged).toBe(false);
        expect(await effects(h.f)).toEqual(NO_EFFECTS);
      } finally { release.resolve(); }
      expect((await confirmation).error).toBeNull();
      expect((await withdrawal)?.error).toBeNull();
      expect(acknowledged).toBe(true);
      expect(await effects(h.f)).toMatchObject({ links: 1, consumed: 1, audits: 1, outbox: 1, debits: 2 });
    });
});
