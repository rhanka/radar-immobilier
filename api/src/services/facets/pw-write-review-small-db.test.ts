import { expect, it, vi } from "vitest";
import { describeDb, workspaceFixture } from "./workspace-archive-fixture.js";
import { preparedSelect } from "./signal-write-fixture.js";
import { pwParams, pwPrepared, pwConfirmation } from "./pw-write-fixture.js";
import { preparePwWriteIntentGuarded } from "./pw-write-prepare.js";
import { revokePwIntent, revokePwAuthority } from "./pw-write-fences.js";
import { confirmPwSignalWrite } from "./pw-write-confirm.js";

describeDb("PW-D preparation, ownership and refusal audit", () => {
  it("should reject mismatched command keys without preparing or charging", async () => {
    const f = await workspaceFixture();
    const params = pwParams(f, await preparedSelect(f));
    params.binding.commandKey = crypto.randomUUID();
    await expect(preparePwWriteIntentGuarded(f.db, params))
      .rejects.toMatchObject({ status: 400, message: "invalid_facet_command" });
    for (const table of ["pw_write_intents", "pw_write_key_reservations", "pw_write_quota_ledger"]) {
      expect((await f.pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n).toBe(0);
    }
  });

  it.each(["binding", "command"])("should accept case-normalized equal %s keys", async (source) => {
    const f = await workspaceFixture();
    const input = await preparedSelect(f);
    const params = pwParams(f, input);
    if (source === "binding") params.binding.commandKey = input.commandKey.toUpperCase();
    else params.command = { ...input, commandKey: input.commandKey.toUpperCase() };
    const row = await preparePwWriteIntentGuarded(f.db, params);
    expect(row.commandKey).toBe(input.commandKey.toLowerCase());
    expect((await confirmPwSignalWrite(f.db, f.contributor.sub, row.intentId, input,
      { confirmation: pwConfirmation(row) })).event?.state).toBe("active");
  });

  it.each(["issuer", "sub", "tier", "actor", "missing"])(
    "should conceal a foreign revocation reference for %s", async (field) => {
      const f = await workspaceFixture();
      const row = await pwPrepared(f, await preparedSelect(f));
      const principal = pwConfirmation(row).principal;
      if (["issuer", "sub", "tier"].includes(field)) Object.assign(principal, { [field]: "foreign" });
      await expect(f.db.transaction((tx) => revokePwIntent(tx,
        field === "missing" ? crypto.randomUUID() : row.intentId,
        field === "actor" ? f.outsider.id : f.contributor.id, principal)))
        .rejects.toMatchObject({ status: 404, message: "write_intent_not_found" });
      expect((await f.pool.query("SELECT revoked_at FROM pw_write_intents")).rows).toEqual([{ revoked_at: null }]);
      expect((await f.pool.query("SELECT count(*)::int AS n FROM pw_write_intent_tombstones")).rows[0].n).toBe(0);
    });

  it.each(["missing", "invalid", "expired"])("should refuse a %s application deadline", async (kind) => {
    const f = await workspaceFixture();
    const input = await preparedSelect(f);
    const row = await pwPrepared(f, input);
    const current = Date.now();
    const confirmation = { ...pwConfirmation(row), sessionExpiresAtMs:
      kind === "missing" ? undefined as unknown as number : kind === "invalid" ? NaN : current };
    await expect(confirmPwSignalWrite(f.db, f.contributor.sub, row.intentId, input,
      { confirmation, clockMs: () => current })).rejects.toMatchObject({ status: 401, message: "session_expired" });
    expect((await f.pool.query("SELECT challenge_state,execution_state FROM pw_write_intents")).rows)
      .toEqual([{ challenge_state: "pending", execution_state: "pending" }]);
    expect((await f.pool.query("SELECT count(*)::int AS n FROM pw_write_quota_ledger WHERE kind='admission'")).rows[0].n).toBe(0);
  });

  it.each(["attempt", "challenge", "grant", "uncertain"])(
    "should preserve requestId and classify the %s refusal", async (kind) => {
      const f = await workspaceFixture();
      const input = await preparedSelect(f);
      const row = await pwPrepared(f, input);
      const confirmation = pwConfirmation(row);
      const requestId = crypto.randomUUID();
      if (kind === "attempt") await f.pool.query(`INSERT INTO pw_write_quota_ledger(kind,bucket,intent_id)
        SELECT 'attempt', 'attempt:' || $1, $2 FROM generate_series(1,60)`,
      [(await import("./pw-write-confirmation.js")).pwReaderBucket(confirmation.principal, row.workspaceId), row.intentId]);
      if (kind === "challenge") confirmation.challengeId = "f".repeat(64);
      if (kind === "grant") await f.db.transaction((tx) => revokePwAuthority(tx, "grant", row.grantReference));
      const spy = kind === "uncertain" ? vi.spyOn(f.db, "transaction")
        .mockImplementationOnce(f.db.transaction.bind(f.db))
        .mockRejectedValueOnce(new Error("unknown transport failure")) : null;
      const code = { attempt: "write_rate_limited", challenge: "challenge_invalid", grant: "write_grant_revoked",
        uncertain: "unknown transport failure" }[kind]!;
      await expect(confirmPwSignalWrite(f.db, f.contributor.sub, row.intentId, input, { confirmation, requestId }))
        .rejects.toMatchObject({ message: code });
      spy?.mockRestore();
      expect((await f.pool.query("SELECT request_id,result FROM pw_write_audit")).rows)
        .toEqual([{ request_id: requestId, result: kind === "uncertain" ? "unknown" : "denied" }]);
    });
});
