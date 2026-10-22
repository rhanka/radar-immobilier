import { expect, it } from "vitest";
import { conflictedCutoverReport, cutoverFixture, describeDb } from "./cutover-fixture.js";
import { recordD5Dispositions } from "./lot-cutover-dispositions.js";

describeDb("6K immutable D5 retries", () => {
  it("should replay exact decisions and reject a different winner or reason", async () => {
    const f = await cutoverFixture();
    const manifest = conflictedCutoverReport();
    const decision = { targetKey: manifest.conflictTargetKey, decision: "activate" as const,
      sourceId: manifest.winnerSourceId, reason: "Synthetic owner disposition" };
    const input = { workspaceId: f.workspaceId, actorSub: f.moderator.sub,
      manifestSha: manifest.report.manifestSha256, decisions: [decision] };
    await recordD5Dispositions(f.db, input);
    await recordD5Dispositions(f.db, input);
    for (const changed of [{ ...decision, sourceId: manifest.loserSourceId },
      { ...decision, reason: "Different rationale" }]) {
      await expect(recordD5Dispositions(f.db, { ...input, decisions: [changed] }))
        .rejects.toMatchObject({ status: 409, message: "idempotency_key_conflict" });
    }
    const rows = (await f.pool.query("SELECT source_id, reason FROM lot_d5_dispositions")).rows;
    expect(rows).toEqual([{ source_id: manifest.winnerSourceId, reason: decision.reason }]);
  });
});
