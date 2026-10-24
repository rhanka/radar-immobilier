import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/lots/lot-fixture.js";
import { lotHttpFixture, type LotComposed } from "./base-api-lot-http-fixture.js";

// Both races below qualify composed outcomes only after observing really
// concurrent PostgreSQL transactions. A start barrier releases both HTTP
// commands on the same tick while a session-level workspace advisory lock
// holds them inside their transactions; the test then observes both
// transactions waiting on that advisory lock before releasing it. B3 keeps
// the real source-writer lock and barrier contention proofs.
async function raceWithObservedOverlap<T>(
  pool: LotComposed["fixture"]["pool"],
  workspaceId: string,
  first: () => Promise<T>,
  second: () => Promise<T>,
): Promise<{ first: T; second: T; waiting: number }> {
  const workspaceKey = JSON.stringify(["workspace", workspaceId.toLowerCase()]);
  const guard = await pool.connect();
  let released = false;
  try {
    await guard.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [workspaceKey]);
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
    const gatedFirst = (async () => { await gate; return first(); })();
    const gatedSecond = (async () => { await gate; return second(); })();
    releaseGate();
    let waiting = 0;
    for (let attempt = 0; attempt < 500; attempt++) {
      const observed = await guard.query(`
        SELECT count(DISTINCT waiting.pid)::integer AS n
        FROM pg_locks waiting
        JOIN pg_locks held USING (locktype, database, classid, objid, objsubid)
        JOIN pg_stat_activity activity ON activity.pid = waiting.pid
        WHERE held.pid = pg_backend_pid() AND held.granted
          AND waiting.locktype = 'advisory' AND NOT waiting.granted
          AND activity.datname = current_database() AND activity.xact_start IS NOT NULL
          AND activity.state = 'active' AND activity.wait_event_type = 'Lock'
          AND pg_backend_pid() = ANY(pg_blocking_pids(waiting.pid))
      `);
      waiting = (observed.rows[0] as { n: number } | undefined)?.n ?? 0;
      if (waiting >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    console.info("B5 workspace transaction overlap", { workspaceId, waiting });
    await guard.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [workspaceKey]);
    guard.release();
    released = true;
    const [firstResult, secondResult] = await Promise.all([gatedFirst, gatedSecond]);
    return { first: firstResult, second: secondResult, waiting };
  } finally {
    if (!released) {
      try { await guard.query("SELECT pg_advisory_unlock_all()"); }
      finally { guard.release(); }
    }
  }
}

describeDb("b5 composed lot concurrency and revocation", () => {
  it("settles one winner under observed concurrent transactions", async () => {
    const f = await lotHttpFixture();
    const { target, displayed } = await f.resolve(0);
    const sub = f.fixture.contributor.sub;
    const base = { mode: "real", target, displayed_version: displayed, expected_head_id: null };
    const before = (await f.fixture.pool.query("SELECT COUNT(*)::integer AS n FROM facet_events"))
      .rows[0]!.n as number;
    const { first: left, second: right, waiting } = await raceWithObservedOverlap(
      f.fixture.pool,
      f.fixture.workspaceId,
      () => f.command("workspace",
        { ...base, mutation: { action: "set_pipeline", status: "sollicite" } }, sub),
      () => f.command("workspace",
        { ...base, mutation: { action: "set_pipeline", status: "lettre_envoyee" } }, sub),
    );
    expect(waiting).toBeGreaterThanOrEqual(2);
    expect([left.status, right.status].sort()).toEqual([200, 409]);
    const after = (await f.fixture.pool.query("SELECT COUNT(*)::integer AS n FROM facet_events"))
      .rows[0]!.n as number;
    expect(after).toBe(before + 1);
    for (const table of ["facet_event_bindings", "facet_streams", "facet_heads", "facet_commands", "facet_command_contexts"]) {
      expect((await f.fixture.pool.query(`SELECT * FROM ${table}`)).rows).toHaveLength(1);
    }
  });

  it("replays identical idempotency keys under observed concurrent transactions", async () => {
    const f = await lotHttpFixture();
    const { target, displayed } = await f.resolve(1);
    const sub = f.fixture.contributor.sub;
    const body = { mode: "real", target, displayed_version: displayed,
      expected_head_id: null, mutation: { action: "set_pipeline", status: "sollicite" } };
    const key = randomUUID();
    const before = await f.sqlSnapshot();
    const { first: left, second: right, waiting } = await raceWithObservedOverlap(
      f.fixture.pool,
      f.fixture.workspaceId,
      () => f.command("workspace", body, sub, key),
      () => f.command("workspace", body, sub, key),
    );
    expect(waiting).toBeGreaterThanOrEqual(2);
    expect(left.status).toBe(200);
    expect(right.status).toBe(200);
    const receipt = await left.text();
    expect(await right.text()).toBe(receipt);
    const events = (await f.fixture.pool.query("SELECT COUNT(*)::integer AS n FROM facet_events"))
      .rows[0]!.n as number;
    expect(events).toBe((before[0] as unknown[]).length + 1);
    const settled = await f.sqlSnapshot();
    const replay = await f.command("workspace", body, sub, key);
    expect(replay.status).toBe(200);
    expect(await replay.text()).toBe(receipt);
    expect(await f.sqlSnapshot()).toEqual(settled);
    for (const table of ["facet_event_bindings", "facet_streams", "facet_heads", "facet_commands", "facet_command_contexts"]) {
      expect((await f.fixture.pool.query(`SELECT * FROM ${table}`)).rows).toHaveLength(1);
    }
  });

  it("conflicts on stale content fingerprints with the current version", async () => {
    const f = await lotHttpFixture();
    const { target, displayed } = await f.resolve(0);
    const sub = f.fixture.contributor.sub;
    await f.fixture.pool.query("UPDATE lot_versions SET raw_ref=$1 WHERE id=$2",
      ["synthetic-6j-stale-probe", displayed.lot_version_id]);
    const before = await f.sqlSnapshot();
    const stale = await f.command("workspace", {
      mode: "real", target, displayed_version: displayed,
      expected_head_id: null, mutation: { action: "select", basket_id: f.fixture.selectionBasket },
    }, sub);
    expect(stale.status).toBe(409);
    const current = await stale.json() as {
      error: string; current: { version: { lot_version_id: string; fingerprint: string } } };
    expect(current.error).toBe("target_version_conflict");
    expect(current.current.version.lot_version_id).toBe(displayed.lot_version_id);
    expect(current.current.version.fingerprint).not.toBe(displayed.fingerprint);
    expect(await f.sqlSnapshot()).toEqual(before);
  });

  it("denies revoked receipt recovery without business payload or mutation", async () => {
    const f = await lotHttpFixture();
    const { target, displayed } = await f.resolve(1);
    const sub = f.fixture.contributor.sub;
    const key = randomUUID();
    const body = { mode: "real", target, displayed_version: displayed,
      expected_head_id: null, mutation: { action: "set_pipeline", status: "sollicite" } };
    expect((await f.command("workspace", body, sub, key)).status).toBe(200);
    const before = await f.sqlSnapshot();
    await f.fixture.pool.query(
      "UPDATE workspace_memberships SET status='revoked', revoked_at=now() WHERE workspace_id=$1 AND account_id=$2",
      [f.fixture.workspaceId, f.fixture.contributor.id]);
    const denied = await f.command("workspace", body, sub, key);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "workspace_membership_required" });
    expect(await f.sqlSnapshot()).toEqual(before);
  });
});
