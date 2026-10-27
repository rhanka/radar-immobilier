import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { writeScopedPersonalFacet } from "./scoped-writer.js";
import { writeWorkspaceArchiveFacet } from "./workspace-writer.js";
import { readWorkspaceArchiveState } from "./workspace-reader.js";
import { describeDb, workspaceFixture, workspaceSignal } from "./workspace-archive-fixture.js";

describeDb("6I command receipt scope", () => {
  it.each(["personal", "workspace"] as const)(
    "should reject a %s receipt reused in the other command family", async (scope) => {
      const f = await workspaceFixture();
      const { target, fingerprint } = await workspaceSignal(f);
      const command = { action: "discard" as const, target, reasonCode: "N-NON-RES",
        expectedHeadId: null, displayedFingerprint: fingerprint, commandKey: randomUUID() };
      const first = scope === "personal" ? writeScopedPersonalFacet : writeWorkspaceArchiveFacet;
      const second = scope === "personal" ? writeWorkspaceArchiveFacet : writeScopedPersonalFacet;
      await first(f.db, f.moderator.sub, f.workspaceId, command);
      await expect(second(f.db, f.moderator.sub, f.workspaceId, command))
        .rejects.toMatchObject({ status: 409, message: "idempotency_key_conflict" });
      const view = await readWorkspaceArchiveState(f.db, f.moderator.sub, f.workspaceId, target);
      expect(scope === "personal" ? view.workspace : view.personal).toBeNull();
      expect((await f.pool.query("SELECT count(*)::int AS n FROM facet_commands")).rows[0].n).toBe(1);
    });

  it.each(["personal", "workspace"] as const)(
    "should serialize concurrent same-key commands across families and workspaces with %s first", async (scope) => {
    const f = await workspaceFixture();
    const { target, fingerprint } = await workspaceSignal(f);
    const commandKey = randomUUID();
    const personal = { action: "discard" as const, target, reasonCode: "N-NON-RES",
      expectedHeadId: null, displayedFingerprint: fingerprint, commandKey };
    const blocker = await f.pool.connect();
    const pending: ReturnType<typeof writeScopedPersonalFacet>[] = [];
    const waitForBlocked = (count: number) => vi.waitFor(async () => {
      const result = await f.pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event = 'advisory'`);
      expect(result.rows[0].n).toBe(count);
    });
    try {
      // Hold the city lock after receipt lookup. A split receipt lock lets
      // both writers miss the receipt before either can commit its event.
      await blocker.query("SELECT pg_advisory_lock(hashtext($1))", [`graph-city:${target.citySlug}`]);
      const start = (family: typeof scope) => family === "personal"
        ? writeScopedPersonalFacet(f.db, f.moderator.sub, f.workspaceId, personal)
        : writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.otherId, personal);
      pending.push(start(scope));
      await waitForBlocked(1);
      pending.push(start(scope === "personal" ? "workspace" : "personal"));
      await waitForBlocked(2);
    } finally {
      await blocker.query("SELECT pg_advisory_unlock_all()");
      blocker.release();
      await Promise.allSettled(pending);
    }
    const outcomes = await Promise.allSettled(pending);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason)
      .toMatchObject({ status: 409, message: "idempotency_key_conflict" });
    expect((await f.pool.query("SELECT count(*)::int AS n FROM facet_commands")).rows[0].n).toBe(1);
    expect((await f.pool.query("SELECT count(*)::int AS n FROM facet_events")).rows[0].n).toBe(1);
  });
});
