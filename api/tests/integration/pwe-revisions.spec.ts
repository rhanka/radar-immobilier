import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { baseState } from "../../src/services/facets/signal-write-fixture.js";
import { readProjectionScope } from "../../src/services/facets/projection-revisions.js";
import { backendPid, blockedBy, effects, latch, outcome } from "./pwe-fixture.js";
import { holdTransaction, revisionFixture } from "./pwe-revision-fixture.js";

describeDb("PWE-05 C04 revision serialization", () => {
  it.each(["personal", "common", "source"] as const)(
    "should refuse a stale intent after the real %s writer commits first", async (kind) => {
      const h = await revisionFixture();
      const held = holdTransaction(h.f.db);
      const mutation = outcome(h.mutate(kind, held.db));
      let pending: ReturnType<typeof outcome> | undefined;
      try {
        await held.reached.wait();
        pending = outcome(h.execute());
        await blockedBy(h.f, held.pid());
      } finally { held.release.resolve(); }
      expect((await mutation).error).toBeNull();
      expect((await pending)?.error).toMatchObject({ message: "projection_revision_conflict" });
      const committedMutation = await baseState(h.f);
      expect((await outcome(h.execute())).error).toMatchObject({ message: "projection_revision_conflict" });
      expect(await baseState(h.f)).toEqual(committedMutation);
      expect(await effects(h.f)).toMatchObject({ links: 0, consumed: 0, audits: 0, outbox: 0, debits: 0 });
    });

  it.each(["personal", "common", "source"] as const)(
    "should retain the validated scope until confirm commits before the %s writer", async (kind) => {
      const h = await revisionFixture();
      const reached = latch(); const release = latch();
      const port = h.admission(); const record = port.recordCommit;
      let pid = 0;
      port.recordCommit = async (tx, result) => {
        await record(tx, result); pid = await backendPid(tx); reached.resolve(); await release.promise;
      };
      const confirmation = outcome(h.execute(port));
      let mutation: ReturnType<typeof outcome> | undefined;
      try {
        await reached.wait();
        mutation = outcome(h.mutate(kind));
        await blockedBy(h.f, pid);
        expect(await effects(h.f)).toMatchObject({ links: 0, consumed: 0, audits: 0, debits: 0 });
      } finally { release.resolve(); }
      expect((await confirmation).error).toBeNull();
      expect((await mutation)?.error).toBeNull();
      expect(await effects(h.f)).toMatchObject({ links: 1, consumed: 1, audits: 1, outbox: 1, debits: 2 });
    });

  it("should preserve A's token after the real private writer for B", async () => {
    const h = await revisionFixture();
    const scope = () => readProjectionScope(h.f.db, h.f.contributor.sub,
      h.f.workspaceId, h.input.target.citySlug, "signal");
    const before = await scope();
    await h.mutate("privateB");
    expect((await scope()).token).toBe(before.token);
    expect((await outcome(h.execute())).error).toBeNull();
    expect(await effects(h.f)).toMatchObject({ events: 2, commands: 2, links: 1, consumed: 1, debits: 2 });
  });
});
