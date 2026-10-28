import { expect, it } from "vitest";
import { describeDb, workspaceFixture } from "./workspace-archive-fixture.js";
import { preparedSelect, baseState, admitSyntheticWrite } from "./signal-write-fixture.js";
import { coordinateSignalWrite } from "./signal-write-admission.js";
import { createDurableWriteAdmission } from "./pw-write-admission-durable.js";
import { pwPrepared, pwConfirmation } from "./pw-write-fixture.js";
import { revokePwAuthority, type PwAuthorityKind } from "./pw-write-fences.js";
import { confirmPwSignalWrite } from "./pw-write-confirm.js";

describeDb("PW-D refusals", () => {
  it("should close a refused immutable snapshot without affecting BASE", async () => {
    const f = await workspaceFixture();
    const input = await preparedSelect(f);
    const row = await pwPrepared(f, input);
    await admitSyntheticWrite(f.db, f.contributor.sub, await preparedSelect(f));
    const before = await baseState(f);
    await expect(confirmPwSignalWrite(f.db, f.contributor.sub, row.intentId, input,
      { confirmation: pwConfirmation(row) })).rejects.toMatchObject({ message: "projection_revision_conflict" });
    expect(await baseState(f)).toEqual(before);
    expect((await f.pool.query("SELECT execution_state,challenge_state FROM pw_write_intents")).rows)
      .toEqual([{ execution_state: "rejected", challenge_state: "pending" }]);
    expect((await f.pool.query("SELECT kind FROM pw_write_outbox")).rows)
      .toEqual([{ kind: "write_rejected" }]);
  });

  it.each(["issuer", "sub", "tier"] as const)("should refuse a different principal %s without effects", async (field) => {
    const f = await workspaceFixture();
    const input = await preparedSelect(f);
    const row = await pwPrepared(f, input);
    const confirmation = pwConfirmation(row);
    confirmation.principal = { ...confirmation.principal, [field]: "another-domain-or-person" };
    const before = await baseState(f);
    await expect(coordinateSignalWrite(f.db, f.contributor.sub, input,
      createDurableWriteAdmission(row.intentId, { confirmation })))
      .rejects.toMatchObject({ message: "confirmation_identity_mismatch" });
    expect(await baseState(f)).toEqual(before);
  });

  it.each(["challengeId", "intentDigest", "keyId"] as const)("should refuse a forged %s", async (field) => {
    const f = await workspaceFixture();
    const input = await preparedSelect(f);
    const row = await pwPrepared(f, input);
    const confirmation = { ...pwConfirmation(row), [field]: "f".repeat(64) };
    await expect(coordinateSignalWrite(f.db, f.contributor.sub, input,
      createDurableWriteAdmission(row.intentId, { confirmation })))
      .rejects.toMatchObject({ message: "challenge_invalid" });
  });

  it("should expire at equality and refuse an extended transport deadline", async () => {
    const f = await workspaceFixture();
    const input = await preparedSelect(f);
    const row = await pwPrepared(f, input);
    const confirmation = pwConfirmation(row);
    await expect(coordinateSignalWrite(f.db, f.contributor.sub, input,
      createDurableWriteAdmission(row.intentId, { confirmation, clockMs: () => input.expiresAtMs })))
      .rejects.toMatchObject({ message: "challenge_expired" });
    await expect(coordinateSignalWrite(f.db, f.contributor.sub,
      { ...input, expiresAtMs: input.expiresAtMs + 1000 },
      createDurableWriteAdmission(row.intentId, { confirmation })))
      .rejects.toMatchObject({ message: "idempotency_key_conflict" });
    expect((await f.pool.query("SELECT challenge_state FROM pw_write_intents")).rows)
      .toEqual([{ challenge_state: "pending" }]);
  });

  it("should refuse a stale projection token without consuming the challenge", async () => {
    const f = await workspaceFixture();
    const input = await preparedSelect(f);
    const row = await pwPrepared(f, input);
    await admitSyntheticWrite(f.db, f.contributor.sub, await preparedSelect(f));
    const before = await baseState(f);
    await expect(coordinateSignalWrite(f.db, f.contributor.sub, input,
      createDurableWriteAdmission(row.intentId, { confirmation: pwConfirmation(row) })))
      .rejects.toMatchObject({ message: "projection_revision_conflict" });
    expect(await baseState(f)).toEqual(before);
    expect((await f.pool.query("SELECT challenge_state FROM pw_write_intents")).rows[0].challenge_state).toBe("pending");
  });

  it.each(["tier", "policy", "release", "delegation", "reader", "grant", "page_session"] as PwAuthorityKind[])(
    "should refuse a revoked %s fence before BASE", async (kind) => {
      const f = await workspaceFixture();
      const input = await preparedSelect(f);
      const row = await pwPrepared(f, input);
      const refs = row.authorityReferences as Record<string, string>;
      await f.db.transaction((tx) => revokePwAuthority(tx, kind, refs[kind]!));
      const before = await baseState(f);
      await expect(coordinateSignalWrite(f.db, f.contributor.sub, input,
        createDurableWriteAdmission(row.intentId, { confirmation: pwConfirmation(row) })))
        .rejects.toMatchObject({ status: 403 });
      expect(await baseState(f)).toEqual(before);
    });
});
