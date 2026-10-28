import { expect, it } from "vitest";
import { describeDb, workspaceFixture } from "./workspace-archive-fixture.js";
import { preparedSelect } from "./signal-write-fixture.js";
import { coordinateSignalWrite } from "./signal-write-admission.js";
import { createDurableWriteAdmission } from "./pw-write-admission-durable.js";
import { pwPrepared, pwConfirmation } from "./pw-write-fixture.js";
import { revokePwAuthority } from "./pw-write-fences.js";

function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describeDb("PW-D authority serialization", () => {
  it("should drain a confirmation before acknowledging grant revocation", async () => {
    const f = await workspaceFixture();
    const input = await preparedSelect(f);
    const row = await pwPrepared(f, input);
    const reached = latch();
    const release = latch();
    const port = createDurableWriteAdmission(row.intentId, { confirmation: pwConfirmation(row) });
    const record = port.recordCommit;
    port.recordCommit = async (tx, result) => { await record(tx, result); reached.resolve(); await release.promise; };
    const confirmation = coordinateSignalWrite(f.db, f.contributor.sub, input, port);
    let revoked = false;
    let revocation: Promise<void> | undefined;
    try {
      await reached.promise;
      revocation = f.db.transaction((tx) => revokePwAuthority(tx, "grant", row.grantReference))
        .then(() => { revoked = true; });
      for (let i = 0; i < 50; i++) {
        const locks = await f.pool.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted");
        if (locks.rowCount) break;
        await new Promise((done) => setTimeout(done, 10));
      }
      expect(revoked).toBe(false);
    } finally { release.resolve(); }
    expect((await confirmation).event?.state).toBe("active");
    await revocation;
    expect(revoked).toBe(true);
    await expect(coordinateSignalWrite(f.db, f.contributor.sub, input,
      createDurableWriteAdmission(row.intentId, { confirmation: pwConfirmation(row) })))
      .rejects.toMatchObject({ message: "write_grant_revoked" });
  });
});
