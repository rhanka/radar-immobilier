import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { describeDb, workspaceFixture, type WorkspaceFixture } from "./workspace-archive-fixture.js";
import { preparedSelect, baseState, admitSyntheticWrite } from "./signal-write-fixture.js";
import { readProjectionScope, bumpGraphSourceRevision } from "./projection-revisions.js";
import { readCommittedSignalReceipt } from "./signal-write-receipt.js";

async function waitForBlocked(f: WorkspaceFixture, pid: number) {
  await vi.waitFor(async () => {
    const result = await f.pool.query(`SELECT EXISTS (SELECT FROM pg_stat_activity
      WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked`, [pid]);
    expect(result.rows[0].blocked).toBe(true);
  }, { timeout: 800, interval: 5 });
}

describeDb("PW-B PostgreSQL lock coverage", () => {
  it("should compare a fresh 6L1 after waiting for a city source refresh", async () => {
    const f = await workspaceFixture();
    const request = await preparedSelect(f);
    await f.db.transaction((tx) => bumpGraphSourceRevision(tx, request.target.citySlug));
    request.expectedProjectionToken = (await readProjectionScope(f.db, f.contributor.sub,
      f.workspaceId, request.target.citySlug, "signal")).token;
    const before = await baseState(f);
    const blocker = await f.pool.connect();
    let outcome: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`graph-city:${request.target.citySlug}`]);
      outcome = admitSyntheticWrite(f.db, f.contributor.sub, request).catch((error: unknown) => error);
      const { rows: [{ pid }] } = await blocker.query("SELECT pg_backend_pid() AS pid");
      await waitForBlocked(f, pid);
      // Another target changes the city's scope while this target's version stays identical.
      await blocker.query("INSERT INTO graph_nodes(id,type,city_slug,label) VALUES($1,'Signal',$2,'Synthetic refresh')",
        [randomUUID(), request.target.citySlug]);
      await blocker.query("UPDATE graph_source_revisions SET revision=revision+1 WHERE city_slug=$1",
        [request.target.citySlug]);
      await blocker.query("COMMIT");
      expect(await outcome).toMatchObject({ message: "projection_revision_conflict" });
      expect(await baseState(f)).toEqual(before);
    } finally {
      await blocker.query("ROLLBACK"); blocker.release(); await outcome;
    }
  });

  it.each(["membership", "approval", "moderation"] as const)(
    "should recheck %s after waiting for the workspace fence", async (kind) => {
      const f = await workspaceFixture();
      const request = await preparedSelect(f, f.moderator.sub);
      if (kind === "moderation") {
        request.operation = "facets.signals.workspace.discard.v1";
        delete request.basket; request.reasonCode = "N-NON-RES";
      }
      const blocker = await f.pool.connect();
      let outcome: Promise<unknown> | undefined;
      try {
        await blocker.query("BEGIN");
        await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [JSON.stringify(["workspace", f.workspaceId])]);
        outcome = admitSyntheticWrite(f.db, f.moderator.sub, request).catch((error: unknown) => error);
        const { rows: [{ pid }] } = await blocker.query("SELECT pg_backend_pid() AS pid");
        await waitForBlocked(f, pid);
        if (kind === "approval") await blocker.query("UPDATE account_users SET status='pending' WHERE id=$1", [f.moderator.id]);
        else await blocker.query(`UPDATE workspace_memberships SET ${kind === "membership"
          ? "status='revoked',revoked_at=clock_timestamp()" : "moderate_archive=false"},revision=revision+1
          WHERE workspace_id=$1 AND account_id=$2`, [f.workspaceId, f.moderator.id]);
        await blocker.query("COMMIT");
        const expected = kind === "approval" ? "account_not_approved" : kind === "membership"
          ? "workspace_membership_required" : "workspace_capability_required";
        expect(await outcome).toMatchObject({ status: 403, message: expected });
        expect((await baseState(f)).facet_commands).toEqual([]);
      } finally {
        await blocker.query("ROLLBACK"); blocker.release(); await outcome;
      }
    });

  it("should expire after a lock wait without executing BASE", async () => {
    const f = await workspaceFixture();
    const request = { ...await preparedSelect(f), expiresAtMs: 1_000 };
    const before = await baseState(f);
    const blocker = await f.pool.connect();
    let now = 0;
    let outcome: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`graph-city:${request.target.citySlug}`]);
      outcome = admitSyntheticWrite(f.db, f.contributor.sub, request, () => now).catch((error: unknown) => error);
      const { rows: [{ pid }] } = await blocker.query("SELECT pg_backend_pid() AS pid");
      await waitForBlocked(f, pid);
      now = 1_000;
      await blocker.query("COMMIT");
      expect(await outcome).toMatchObject({ message: "challenge_expired" });
      expect(await baseState(f)).toEqual(before);
    } finally {
      await blocker.query("ROLLBACK"); blocker.release(); await outcome;
    }
  });

  it("should deny receipt disclosure after rights are revoked", async () => {
    const f = await workspaceFixture();
    const request = await preparedSelect(f);
    await admitSyntheticWrite(f.db, f.contributor.sub, request);
    await f.pool.query("UPDATE workspace_memberships SET status='revoked',revoked_at=clock_timestamp() WHERE workspace_id=$1 AND account_id=$2",
      [f.workspaceId, f.contributor.id]);
    const before = await baseState(f);
    await expect(readCommittedSignalReceipt(f.db, f.contributor.sub, f.workspaceId, request.commandKey))
      .rejects.toMatchObject({ message: "workspace_membership_required" });
    expect(await baseState(f)).toEqual(before);
  });
});
