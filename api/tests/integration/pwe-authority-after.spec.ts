import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { PW_FENCE_ORDER, revokePwAuthority, type PwAuthorityKind } from "../../src/services/facets/pw-write-fences.js";
import { backendPid, blockedBy, effects, latch, ONE_COMMIT, outcome, writeFixture } from "./pwe-fixture.js";

describeDb("PWE-06 C03 admission before authority withdrawal", () => {
  it.each(PW_FENCE_ORDER)("should drain a confirmation before acknowledging %s withdrawal", async (kind) => {
    const h = await writeFixture();
    const reference = (h.row.authorityReferences as Record<PwAuthorityKind, string>)[kind];
    expect(typeof reference).toBe("string");
    const reached = latch();
    const release = latch();
    const port = h.admission();
    const record = port.recordCommit;
    let pid = 0;
    let acknowledged = false;
    port.recordCommit = async (tx, result) => {
      await record(tx, result); pid = await backendPid(tx);
      reached.resolve(); await release.promise;
    };
    const confirmation = outcome(h.execute(port));
    const withdraw = () => outcome(h.f.db.transaction((tx) => revokePwAuthority(tx, kind, reference)))
      .then((result) => { acknowledged = true; return result; });
    let withdrawal: ReturnType<typeof withdraw> | undefined;
    try {
      await reached.wait();
      withdrawal = withdraw();
      await blockedBy(h.f, pid);
      expect(acknowledged).toBe(false);
    } finally { release.resolve(); }
    expect((await confirmation).error).toBeNull();
    expect((await withdrawal)?.error).toBeNull();
    expect(acknowledged).toBe(true);
    expect(await effects(h.f)).toEqual(ONE_COMMIT);
    await expect(h.execute()).rejects.toMatchObject({ status: 403,
      message: kind === "grant" ? "write_grant_revoked"
        : kind === "page_session" ? "page_session_revoked" : "write_authority_unavailable" });
    expect(await effects(h.f)).toEqual(ONE_COMMIT);
  });
});
