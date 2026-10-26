import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { facetEvents, workspaceMembershipEvents } from "../../db/schema.js";
import { describeDb, workspaceFixture } from "./workspace-archive-fixture.js";
import { coordinateSignalWrite, executeSignalWriteInTx } from "./signal-write-admission.js";
import { syntheticAdmission, preparedSelect, baseState, admitSyntheticWrite } from "./signal-write-fixture.js";
import { readCommittedSignalReceipt } from "./signal-write-receipt.js";
import { ScopeError } from "./scope.js";
import { writeScopedPersonalFacet } from "./scoped-writer.js";

describeDb("PW-B transactional admission", () => {
  it("should close admission without PW-D instead of writing BASE", async () => {
    const f = await workspaceFixture();
    const request = await preparedSelect(f);
    const before = await baseState(f);
    await expect(coordinateSignalWrite(f.db, f.contributor.sub, request, undefined as never))
      .rejects.toMatchObject({ message: "write_authority_unavailable" });
    expect(await baseState(f)).toEqual(before);
  });

  it("should roll back consumption, all BASE rows and audit on final expiration", async () => {
    const f = await workspaceFixture();
    const request = { ...await preparedSelect(f), expiresAtMs: 1_000 };
    const before = await baseState(f);
    const port = syntheticAdmission(request);
    port.consume = async (tx) => {
      await tx.insert(workspaceMembershipEvents).values({ workspaceId: f.workspaceId,
        accountId: f.contributor.id, actorId: f.moderator.id, kind: "member_added",
        reason: "synthetic PW-D consumption and quota" });
    };
    const clock = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(1_000);
    await expect(coordinateSignalWrite(f.db, f.contributor.sub, request, port, clock))
      .rejects.toMatchObject({ message: "challenge_expired" });
    expect(await baseState(f)).toEqual(before);
  });

  it("should roll back BASE if the mandatory PW-D audit fails", async () => {
    const f = await workspaceFixture();
    const request = await preparedSelect(f);
    const before = await baseState(f);
    const port = syntheticAdmission(request);
    port.recordCommit = async (tx) => {
      expect((await tx.select().from(facetEvents)).length).toBe(1);
      throw new ScopeError(503, "write_audit_unavailable");
    };
    await expect(coordinateSignalWrite(f.db, f.contributor.sub, request, port))
      .rejects.toMatchObject({ message: "write_audit_unavailable" });
    expect(await baseState(f)).toEqual(before);
    // Rollback did not consume the synthetic challenge or reserve a receipt.
    expect((await admitSyntheticWrite(f.db, f.contributor.sub, request)).event).not.toBeNull();
  });

  it("should reject a BASE receipt unrelated to a pending intent", async () => {
    const f = await workspaceFixture();
    const request = await preparedSelect(f);
    await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
      { ...request, action: "select" });
    const before = await baseState(f);
    await expect(admitSyntheticWrite(f.db, f.contributor.sub, request))
      .rejects.toMatchObject({ message: "command_context_unresolved" });
    expect(await baseState(f)).toEqual(before);
  });

  it("should join the caller transaction and roll back its complete receipt", async () => {
    const f = await workspaceFixture();
    const request = await preparedSelect(f);
    const before = await baseState(f);
    await expect(f.db.transaction(async (tx) => {
      await executeSignalWriteInTx(tx, f.contributor.sub, request, syntheticAdmission(request));
      throw new Error("synthetic caller rollback");
    })).rejects.toThrow("synthetic caller rollback");
    expect(await baseState(f)).toEqual(before);
  });

  it("should refuse a snapshot captured before advisory-lock waits", async () => {
    const f = await workspaceFixture();
    const request = await preparedSelect(f);
    await expect(f.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT 1`);
      return executeSignalWriteInTx(tx, f.contributor.sub, request, syntheticAdmission(request));
    }, { isolationLevel: "repeatable read" }))
      .rejects.toMatchObject({ message: "write_fence_unavailable" });
  });

  it("should preserve no-op receipts and reject their consumed confirmations", async () => {
    const f = await workspaceFixture();
    const { basket: _basket, ...base } = await preparedSelect(f);
    const request = { ...base, operation: "facets.signals.personal.restore.v1" as const };
    expect((await admitSyntheticWrite(f.db, f.contributor.sub, request)).event).toBeNull();
    await expect(admitSyntheticWrite(f.db, f.contributor.sub, request))
      .rejects.toMatchObject({ message: "challenge_consumed" });
    expect(await readCommittedSignalReceipt(f.db, f.contributor.sub,
      f.workspaceId, request.commandKey)).toBeNull();
    await expect(readCommittedSignalReceipt(f.db, f.contributor.sub,
      f.workspaceId, randomUUID())).rejects.toMatchObject({ status: 404 });
  });
});
