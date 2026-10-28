import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { baseState } from "../../src/services/facets/signal-write-fixture.js";
import { PW_FENCE_ORDER, revokePwAuthority, type PwAuthorityKind } from "../../src/services/facets/pw-write-fences.js";
import { backendPid, blockedBy, effects, latch, NO_EFFECTS, outcome, writeFixture } from "./pwe-fixture.js";

describeDb("PWE-06 C03 authority withdrawal before admission", () => {
  it.each(PW_FENCE_ORDER)("should refuse admission when %s withdrawal commits before the waiting confirmation", async (kind) => {
    const h = await writeFixture();
    const before = await baseState(h.f);
    const reference = (h.row.authorityReferences as Record<PwAuthorityKind, string>)[kind];
    expect(typeof reference).toBe("string");
    const reached = latch();
    const release = latch();
    let pid = 0;
    const withdrawal = outcome(h.f.db.transaction(async (tx) => {
      await revokePwAuthority(tx, kind, reference);
      pid = await backendPid(tx); reached.resolve(); await release.promise;
    }));
    const run = () => outcome(h.execute());
    let confirmation: ReturnType<typeof run> | undefined;
    try {
      await reached.wait();
      confirmation = run();
      await blockedBy(h.f, pid);
    } finally { release.resolve(); }
    expect((await withdrawal).error).toBeNull();
    expect((await confirmation)?.error).toMatchObject({ status: 403,
      message: kind === "grant" ? "write_grant_revoked"
        : kind === "page_session" ? "page_session_revoked" : "write_authority_unavailable" });
    expect(await effects(h.f)).toEqual(NO_EFFECTS);
    expect(await baseState(h.f)).toEqual(before);
    expect((await h.f.pool.query("SELECT kind, reference FROM pw_write_authority_fences")).rows)
      .toEqual([{ kind, reference }]);
  });
});
