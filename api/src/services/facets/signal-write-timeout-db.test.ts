import { expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { facetEvents, workspaceMembershipEvents } from "../../db/schema.js";
import { describeDb, workspaceFixture } from "./workspace-archive-fixture.js";
import { baseState, preparedSelect, syntheticAdmission, admitSyntheticWrite } from "./signal-write-fixture.js";
import { coordinateSignalWrite, executeSignalWriteInTx } from "./signal-write-admission.js";
import { toWriteRefusal } from "./signal-write-receipt.js";

describeDb("PW-B pre-commit lock timeout", () => {
  it.each(["coordinator", "caller"] as const)(
    "should roll back every write on audit lock timeout in the %s transaction", async (owner) => {
      const f = await workspaceFixture();
      const request = await preparedSelect(f);
      const before = await baseState(f);
      const port = syntheticAdmission(request);
      port.consume = async (tx) => {
        await tx.insert(workspaceMembershipEvents).values({ workspaceId: f.workspaceId,
          accountId: f.contributor.id, actorId: f.moderator.id, kind: "member_added",
          reason: "synthetic PW-D consumption and quota" });
      };
      const recordCommit = port.recordCommit;
      port.recordCommit = async (tx, result) => {
        await recordCommit(tx, result);
        expect(await tx.select().from(facetEvents)).toHaveLength(1);
        expect(await tx.select().from(workspaceMembershipEvents))
          .toHaveLength(before.workspace_membership_events.length + 2);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('synthetic-pw-b-audit'))`);
      };
      const blocker = await f.pool.connect();
      let outcome: Promise<unknown> | undefined;
      try {
        await blocker.query("BEGIN");
        await blocker.query("SELECT pg_advisory_xact_lock(hashtext('synthetic-pw-b-audit'))");
        const { rows: [{ pid }] } = await blocker.query("SELECT pg_backend_pid() AS pid");
        const attempt = owner === "coordinator"
          ? coordinateSignalWrite(f.db, f.contributor.sub, request, port)
          : f.db.transaction((tx) => executeSignalWriteInTx(tx, f.contributor.sub, request, port));
        outcome = attempt.catch((error: unknown) => error);
        await vi.waitFor(async () => {
          const { rows } = await f.pool.query(`SELECT EXISTS (SELECT FROM pg_stat_activity
            WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked`, [pid]);
          expect(rows[0].blocked).toBe(true);
        }, { timeout: 800, interval: 5 });
        const failure = await outcome;
        let cause = failure;
        while (cause instanceof Error && cause.cause) cause = cause.cause;
        expect(cause).toMatchObject({ code: "55P03" });
        expect(toWriteRefusal(failure))
          .toEqual({ status: 503, code: "write_fence_unavailable", retryable: false });
        expect(await baseState(f)).toEqual(before);
      } finally {
        await blocker.query("ROLLBACK"); blocker.release(); await outcome;
      }
      expect((await admitSyntheticWrite(f.db, f.contributor.sub, request)).event?.state).toBe("active");
    });
});
