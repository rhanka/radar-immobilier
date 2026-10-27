import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { baseState } from "../../src/services/facets/signal-write-fixture.js";
import { pwConfirmation } from "../../src/services/facets/pw-write-fixture.js";
import { revokePwIntent } from "../../src/services/facets/pw-write-fences.js";
import { backendPid, blockedBy, effects, latch, NO_EFFECTS, ONE_COMMIT, outcome, writeFixture } from "./pwe-fixture.js";

describeDb("PWE-06 C02 confirm and revoke ordering", () => {
  it.each(["commit", "rollback"])("should serialize revoke behind a confirmation that will %s", async (decision) => {
    const h = await writeFixture();
    const reached = latch();
    const release = latch();
    const port = h.admission();
    const record = port.recordCommit;
    let pid = 0;
    port.recordCommit = async (tx, result) => {
      await record(tx, result); pid = await backendPid(tx);
      reached.resolve(); await release.promise;
      if (decision === "rollback") throw new Error("PWE confirmation rollback");
    };
    const first = outcome(h.execute(port));
    const revoke = () => outcome(h.f.db.transaction((tx) => revokePwIntent(tx,
      h.row.intentId, h.row.actorId, pwConfirmation(h.row).principal)));
    let withdrawing: ReturnType<typeof revoke> | undefined;
    try {
      await reached.wait();
      expect(await effects(h.f)).toEqual(NO_EFFECTS);
      withdrawing = revoke();
      await blockedBy(h.f, pid);
    } finally { release.resolve(); }
    const confirmation = await first;
    if (decision === "commit") expect(confirmation.error).toBeNull();
    else expect(confirmation.error).toMatchObject({ message: "PWE confirmation rollback" });
    const withdrawal = await withdrawing;
    expect(withdrawal?.error).toBeNull();
    expect(withdrawal?.value).toEqual({ committed: decision === "commit" });
    expect(await effects(h.f)).toEqual(decision === "commit" ? ONE_COMMIT : NO_EFFECTS);
    await expect(h.execute()).rejects.toMatchObject({ message:
      decision === "commit" ? "challenge_consumed" : "write_intent_revoked" });
    expect((await h.f.pool.query("SELECT revoked_at IS NOT NULL AS revoked FROM pw_write_intents"))
      .rows).toEqual([{ revoked: true }]);
  });

  it("should admit no writer after an earlier revoke and retain its original acknowledgement", async () => {
    const h = await writeFixture();
    const before = await baseState(h.f);
    const reached = latch();
    const release = latch();
    let pid = 0;
    const withdrawal = outcome(h.f.db.transaction(async (tx) => {
      const result = await revokePwIntent(tx, h.row.intentId, h.row.actorId, pwConfirmation(h.row).principal);
      pid = await backendPid(tx); reached.resolve(); await release.promise;
      return result;
    }));
    const confirm = () => outcome(h.execute());
    let confirming: ReturnType<typeof confirm> | undefined;
    try {
      await reached.wait();
      confirming = confirm();
      await blockedBy(h.f, pid);
    } finally { release.resolve(); }
    expect((await withdrawal).value).toEqual({ committed: false });
    expect((await confirming)?.error).toMatchObject({ message: "write_intent_revoked" });
    expect(await effects(h.f)).toEqual(NO_EFFECTS);
    expect(await baseState(h.f)).toEqual(before);
    const stamp = async () => (await h.f.pool.query("SELECT revoked_at::text AS at FROM pw_write_intents")).rows;
    const original = await stamp();
    for (let retry = 0; retry < 2; retry++) {
      expect(await h.f.db.transaction((tx) => revokePwIntent(tx, h.row.intentId,
        h.row.actorId, pwConfirmation(h.row).principal))).toEqual({ committed: false });
      expect(await stamp()).toEqual(original);
    }
    expect((await h.f.pool.query("SELECT count(*)::int AS total FROM pw_write_audit WHERE result='revoked'"))
      .rows).toEqual([{ total: 1 }]);
  });
});
