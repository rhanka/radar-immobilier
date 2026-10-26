import { expect, it } from "vitest";
import { describeDb, workspaceFixture } from "./workspace-archive-fixture.js";
import { preparedSelect, baseState, admitSyntheticWrite } from "./signal-write-fixture.js";
import { coordinateSignalWrite } from "./signal-write-admission.js";
import { createDurableWriteAdmission, readPwWriteStatus } from "./pw-write-admission-durable.js";
import { pwPrepared, pwConfirmation } from "./pw-write-fixture.js";
import { revokePwIntent } from "./pw-write-fences.js";
import { listPwPendingOutbox, notePwOutboxAttempt, markPwOutboxDelivered } from "./pw-write-outbox.js";

describeDb("PW-D atomicity", () => {
  it("should refuse an existing receipt link bound to another BASE command", async () => {
    const f = await workspaceFixture();
    const other = await preparedSelect(f);
    await admitSyntheticWrite(f.db, f.contributor.sub, other);
    const input = await preparedSelect(f);
    const row = await pwPrepared(f, input);
    await f.pool.query("INSERT INTO pw_write_receipt_links(intent_id,owner_id,command_key,workspace_id) VALUES ($1,$2,$3,$4)",
      [row.intentId, f.contributor.id, other.commandKey, f.workspaceId]);
    const before = await baseState(f);
    await expect(coordinateSignalWrite(f.db, f.contributor.sub, input,
      createDurableWriteAdmission(row.intentId, { confirmation: pwConfirmation(row) })))
      .rejects.toMatchObject({ message: "command_context_unresolved" });
    expect(await baseState(f)).toEqual(before);
    expect((await f.pool.query("SELECT challenge_state FROM pw_write_intents")).rows[0].challenge_state).toBe("pending");
  });

  it("should roll back durable consumption and outbox when final admission expires", async () => {
    const f = await workspaceFixture();
    const input = await preparedSelect(f);
    const row = await pwPrepared(f, input);
    let current = Date.now();
    const clock = () => current;
    const port = createDurableWriteAdmission(row.intentId,
      { confirmation: pwConfirmation(row), clockMs: clock });
    const record = port.recordCommit;
    port.recordCommit = async (tx, result) => { await record(tx, result); current = input.expiresAtMs; };
    const before = await baseState(f);
    await expect(coordinateSignalWrite(f.db, f.contributor.sub, input, port, clock))
      .rejects.toMatchObject({ message: "challenge_expired" });
    expect(await baseState(f)).toEqual(before);
    expect((await f.pool.query("SELECT challenge_state,execution_state FROM pw_write_intents")).rows)
      .toEqual([{ challenge_state: "pending", execution_state: "pending" }]);
    for (const table of ["pw_write_outbox", "pw_write_audit", "pw_write_receipt_links"]) {
      expect((await f.pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n).toBe(0);
    }
  });

  it("should debit a no-op once and retain its immutable receipt link", async () => {
    const f = await workspaceFixture();
    const selected = await preparedSelect(f);
    const input = { operation: "facets.signals.personal.restore.v1" as const,
      workspaceId: selected.workspaceId, target: selected.target,
      expectedHeadId: null, displayedFingerprint: selected.displayedFingerprint,
      expectedProjectionToken: selected.expectedProjectionToken,
      commandKey: selected.commandKey, expiresAtMs: selected.expiresAtMs };
    const row = await pwPrepared(f, input);
    const run = () => coordinateSignalWrite(f.db, f.contributor.sub, input,
      createDurableWriteAdmission(row.intentId, { confirmation: pwConfirmation(row) }));
    expect((await run()).event).toBeNull();
    await expect(run()).rejects.toMatchObject({ message: "challenge_consumed" });
    expect((await f.pool.query("SELECT count(*)::int AS n FROM pw_write_quota_ledger WHERE kind='admission'")).rows[0].n).toBe(2);
    expect((await f.pool.query("SELECT count(*)::int AS n FROM pw_write_receipt_links")).rows[0].n).toBe(1);
  });

  it("should admit only one concurrent confirmation", async () => {
    const f = await workspaceFixture();
    const input = await preparedSelect(f);
    const row = await pwPrepared(f, input);
    const run = () => coordinateSignalWrite(f.db, f.contributor.sub, input,
      createDurableWriteAdmission(row.intentId, { confirmation: pwConfirmation(row) }));
    const results = await Promise.allSettled([run(), run()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { message: "challenge_consumed" } });
    expect((await f.pool.query("SELECT count(*)::int AS n FROM pw_write_receipt_links")).rows[0].n).toBe(1);
  });

  it.each(["pw_write_audit", "pw_write_outbox"])("should roll back all writes if %s fails", async (table) => {
    const f = await workspaceFixture();
    const input = await preparedSelect(f);
    const row = await pwPrepared(f, input);
    await f.pool.query(`CREATE FUNCTION synthetic_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic unavailable'; END $$;
      CREATE TRIGGER synthetic_failure BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION synthetic_failure()`);
    const before = await baseState(f);
    await expect(coordinateSignalWrite(f.db, f.contributor.sub, input,
      createDurableWriteAdmission(row.intentId, { confirmation: pwConfirmation(row) }))).rejects.toThrow();
    expect(await baseState(f)).toEqual(before);
    expect((await f.pool.query("SELECT challenge_state,execution_state FROM pw_write_intents")).rows)
      .toEqual([{ challenge_state: "pending", execution_state: "pending" }]);
    expect((await f.pool.query("SELECT count(*)::int AS n FROM pw_write_quota_ledger WHERE kind='admission'")).rows[0].n).toBe(0);
    expect((await f.pool.query("SELECT count(*)::int AS n FROM pw_write_receipt_links")).rows[0].n).toBe(0);
  });

  it("should revoke committed disclosure idempotently and retry only outbox delivery", async () => {
    const f = await workspaceFixture();
    const input = await preparedSelect(f);
    const row = await pwPrepared(f, input);
    const confirmation = pwConfirmation(row);
    await coordinateSignalWrite(f.db, f.contributor.sub, input,
      createDurableWriteAdmission(row.intentId, { confirmation }));
    const before = await baseState(f);
    for (let i = 0; i < 2; i++) expect(await f.db.transaction((tx) =>
      revokePwIntent(tx, row.intentId, f.contributor.id, confirmation.principal))).toEqual({ committed: true });
    expect(await readPwWriteStatus(f.db, row.intentId, confirmation.principal, row.pageSessionId))
      .toMatchObject({ status: "revoked", executionState: "committed" });
    const pending = await f.db.transaction((tx) => listPwPendingOutbox(tx, 10));
    expect(pending.map((r) => r.kind)).toEqual(["write_committed", "write_revoked"]);
    for (const entry of pending) {
      await f.db.transaction((tx) => notePwOutboxAttempt(tx, entry.id));
      await f.db.transaction((tx) => markPwOutboxDelivered(tx, entry.id));
      await f.db.transaction((tx) => markPwOutboxDelivered(tx, entry.id));
    }
    expect(await f.db.transaction((tx) => listPwPendingOutbox(tx, 10))).toEqual([]);
    expect(await baseState(f)).toEqual(before);
  });
});
