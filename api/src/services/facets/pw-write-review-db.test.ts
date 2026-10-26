import { expect, it } from "vitest";
import { describeDb, workspaceFixture } from "./workspace-archive-fixture.js";
import { preparedSelect, baseState, admitSyntheticWrite } from "./signal-write-fixture.js";
import { pwPrepared, pwConfirmation } from "./pw-write-fixture.js";
import { confirmPwSignalWrite } from "./pw-write-confirm.js";
import { readPwWriteStatus } from "./pw-write-admission-durable.js";
import { markPwOutboxDelivered } from "./pw-write-outbox.js";

describeDb("PW-D review regressions", () => {
  it("should retain the terminal refusal after a lost response and outbox delivery", async () => {
    const f = await workspaceFixture();
    const input = await preparedSelect(f);
    const row = await pwPrepared(f, input);
    const confirmation = pwConfirmation(row);
    await admitSyntheticWrite(f.db, f.contributor.sub, await preparedSelect(f));
    const before = await baseState(f);
    const confirm = () => confirmPwSignalWrite(f.db, f.contributor.sub, row.intentId, input, { confirmation });
    await expect(confirm()).rejects.toMatchObject({ status: 409, message: "projection_revision_conflict" });
    const outbox = await f.pool.query("SELECT id FROM pw_write_outbox");
    await f.db.transaction((tx) => markPwOutboxDelivered(tx, outbox.rows[0].id));
    await f.pool.query("ALTER TABLE pw_write_outbox RENAME TO unavailable_pw_outbox");
    await expect(confirm()).rejects.toMatchObject({ status: 409, message: "projection_revision_conflict" });
    expect(await readPwWriteStatus(f.db, row.intentId, confirmation.principal, row.pageSessionId)).toMatchObject({
      status: "rejected", error: { status: 409, code: "projection_revision_conflict" },
    });
    expect(await baseState(f)).toEqual(before);
    expect((await f.pool.query("SELECT count(*)::int AS n FROM pw_write_quota_ledger WHERE kind='admission'")).rows[0].n).toBe(0);
  });

  it("should retain the fixed status window and reject an early manual follow-up", async () => {
    const f = await workspaceFixture();
    const row = await pwPrepared(f, await preparedSelect(f));
    const principal = pwConfirmation(row).principal;
    const first = Date.now();
    await readPwWriteStatus(f.db, row.intentId, principal, row.pageSessionId, () => first);
    await readPwWriteStatus(f.db, row.intentId, principal, row.pageSessionId, () => first + 120_000);
    const refusal = await readPwWriteStatus(f.db, row.intentId, principal, row.pageSessionId, () => first + 122_000)
      .then(() => null, (error: Error & { status: number }) => ({ status: error.status, message: error.message }));
    expect(refusal).toEqual({ status: 429, message: "write_rate_limited" });
  });

  it("should roll back when only the application cookie expires during the last SQL wait", async () => {
    const f = await workspaceFixture();
    const input = await preparedSelect(f);
    const row = await pwPrepared(f, input);
    let current = Date.now();
    const confirmation = { ...pwConfirmation(row), sessionExpiresAtMs: current + 1000 };
    const requestId = crypto.randomUUID();
    const before = await baseState(f);
    const blocker = await f.pool.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock(987654321)");
    await f.pool.query(`CREATE FUNCTION cookie_wait() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_advisory_xact_lock(987654321); RETURN NEW; END $$;
      CREATE TRIGGER cookie_wait BEFORE INSERT ON pw_write_outbox FOR EACH ROW EXECUTE FUNCTION cookie_wait()`);
    const outcome = confirmPwSignalWrite(f.db, f.contributor.sub, row.intentId, input,
      { confirmation, requestId, clockMs: () => current }).then(
      (value) => ({ value }), (error: unknown) => ({ error }));
    try {
      let waiting = false;
      for (let i = 0; i < 60; i++) {
        const locks = await f.pool.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted");
        if (locks.rowCount) { waiting = true; break; }
        await new Promise((done) => setTimeout(done, 5));
      }
      expect(waiting).toBe(true);
      current = confirmation.sessionExpiresAtMs;
      expect(current).toBeLessThan(input.expiresAtMs);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    expect(await outcome).toMatchObject({ error: { status: 401, message: "session_expired" } });
    expect(await baseState(f)).toEqual(before);
    expect((await f.pool.query("SELECT challenge_state,execution_state,expires_at FROM pw_write_intents")).rows)
      .toEqual([{ challenge_state: "pending", execution_state: "pending", expires_at: row.expiresAt }]);
    for (const table of ["pw_write_outbox", "pw_write_receipt_links"]) {
      expect((await f.pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n).toBe(0);
    }
    expect((await f.pool.query("SELECT count(*)::int AS n FROM pw_write_quota_ledger WHERE kind='admission'")).rows[0].n).toBe(0);
    expect((await f.pool.query("SELECT request_id,result FROM pw_write_audit")).rows)
      .toEqual([{ request_id: requestId, result: "denied" }]);
  });
});
