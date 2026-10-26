import { expect, it } from "vitest";
import { describeDb, workspaceFixture } from "./workspace-archive-fixture.js";
import { preparedSelect, baseState } from "./signal-write-fixture.js";
import { coordinateSignalWrite } from "./signal-write-admission.js";
import { readCommittedSignalReceipt } from "./signal-write-receipt.js";
import { createDurableWriteAdmission } from "./pw-write-admission-durable.js";
import { confirmPwSignalWrite } from "./pw-write-confirm.js";
import { revokePwIntent } from "./pw-write-fences.js";
import { readPwAuditForIntent } from "./pw-write-audit.js";
import { listPwPendingOutbox } from "./pw-write-outbox.js";
import { pwPrepared, pwConfirmation } from "./pw-write-fixture.js";

describeDb("PW-D durable admission", () => {
  it("should commit once, refuse replay before stale 6L1, and record audit with outbox", async () => {
    const f = await workspaceFixture();
    const input = await preparedSelect(f);
    const row = await pwPrepared(f, input);
    const options = { confirmation: pwConfirmation(row) };
    const committed = await confirmPwSignalWrite(f.db, f.contributor.sub, row.intentId, input, options);
    expect(committed.event).toMatchObject({ state: "active", basket: "pertinent" });
    expect(await readCommittedSignalReceipt(f.db, f.contributor.sub,
      f.workspaceId, input.commandKey)).toEqual(committed.event);
    const before = await baseState(f);
    await expect(confirmPwSignalWrite(f.db, f.contributor.sub, row.intentId, input, options))
      .rejects.toMatchObject({ message: "challenge_consumed" });
    expect(await baseState(f)).toEqual(before);
    const audit = await f.db.transaction((tx) => readPwAuditForIntent(tx, row.intentId));
    expect(audit.map((entry) => entry.result)).toEqual(["committed", "replay_denied"]);
    const outbox = await f.db.transaction((tx) => listPwPendingOutbox(tx, 10));
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.intentId).toBe(row.intentId);
    expect((await f.pool.query("SELECT kind, count(*)::int AS n FROM pw_write_quota_ledger GROUP BY kind ORDER BY kind")).rows)
      .toEqual([{ kind: "admission", n: 2 }, { kind: "attempt", n: 2 }, { kind: "prepare", n: 1 }]);
  });

  it("should serialize revoke before confirm with zero BASE effects", async () => {
    const f = await workspaceFixture();
    const input = await preparedSelect(f);
    const row = await pwPrepared(f, input);
    const before = await baseState(f);
    expect(await f.db.transaction((tx) => revokePwIntent(tx, row.intentId, f.contributor.id, pwConfirmation(row).principal)))
      .toEqual({ committed: false });
    await expect(coordinateSignalWrite(f.db, f.contributor.sub, input,
      createDurableWriteAdmission(row.intentId, { confirmation: pwConfirmation(row) })))
      .rejects.toMatchObject({ message: "write_intent_revoked" });
    expect(await baseState(f)).toEqual(before);
  });
});
