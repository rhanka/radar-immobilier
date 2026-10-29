import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { readPwWriteStatus } from "../../src/services/facets/pw-write-admission-durable.js";
import { pwConfirmation } from "../../src/services/facets/pw-write-fixture.js";
import { backendPid, blockedBy, effects, latch, NO_EFFECTS, ONE_COMMIT, outcome, writeFixture } from "./pwe-fixture.js";

describeDb("PWE-08 C09 status waits for the committing decision", () => {
  it.each([false, true])("should avoid a premature expired decision with confirm rollback=$0", async (rollback) => {
    const h = await writeFixture();
    const reached = latch(); const release = latch();
    const port = h.admission(); const record = port.recordCommit;
    let pid = 0; let settled = false;
    port.recordCommit = async (tx, result) => {
      await record(tx, result); pid = await backendPid(tx); reached.resolve(); await release.promise;
      if (rollback) throw new Error("PWE status rollback");
    };
    const confirmation = outcome(h.execute(port));
    let status: ReturnType<typeof outcome<Awaited<ReturnType<typeof readPwWriteStatus>>>> | undefined;
    try {
      await reached.wait();
      status = outcome(readPwWriteStatus(h.f.db, h.row.intentId, pwConfirmation(h.row).principal,
        h.row.pageSessionId, () => h.input.expiresAtMs)).then((result) => { settled = true; return result; });
      await blockedBy(h.f, pid);
      expect(settled).toBe(false);
      expect(await effects(h.f)).toEqual(NO_EFFECTS);
    } finally { release.resolve(); }
    expect((await confirmation).error).toEqual(rollback ? new Error("PWE status rollback") : null);
    const observed = await status;
    expect(observed?.error).toBeNull();
    expect(observed?.value).toMatchObject({ status: rollback ? "expired" : "committed",
      executionState: rollback ? "pending" : "committed", challengeState: rollback ? "pending" : "consumed" });
    expect(await effects(h.f)).toEqual(rollback ? NO_EFFECTS : ONE_COMMIT);
  });
});
