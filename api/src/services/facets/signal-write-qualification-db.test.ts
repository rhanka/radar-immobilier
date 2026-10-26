import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb, workspaceFixture, workspaceSignal } from "./workspace-archive-fixture.js";
import { admitSyntheticWrite as coordinateSignalWrite } from "./signal-write-fixture.js";
import { preparedSelect, baseState } from "./signal-write-fixture.js";
import { readProjectionScope } from "./projection-revisions.js";

describeDb("PW-B adversarial admission", () => {
  it("should refuse confirmation replay instead of replacing the prepared token", async () => {
    const f = await workspaceFixture();
    const { target, fingerprint } = await workspaceSignal(f);
    const { token } = await readProjectionScope(f.db, f.contributor.sub,
      f.workspaceId, target.citySlug, "signal");
    const request = {
      operation: "facets.signals.personal.select.v1" as const, workspaceId: f.workspaceId,
      target, basket: "pertinent" as const, expectedHeadId: null,
      displayedFingerprint: fingerprint, expectedProjectionToken: token,
      commandKey: randomUUID(), expiresAtMs: Date.now() + 60_000,
    };
    const first = await coordinateSignalWrite(f.db, f.contributor.sub, request);
    await expect(coordinateSignalWrite(f.db, f.contributor.sub, request))
      .rejects.toMatchObject({ message: "challenge_consumed" });
    await expect(coordinateSignalWrite(f.db, f.contributor.sub,
      { ...request, expectedProjectionToken: first.scopeAfter }))
      .rejects.toMatchObject({ message: "idempotency_key_conflict" });
  });

  it("should admit only one concurrent confirmation of the same prepared command", async () => {
    const f = await workspaceFixture();
    const request = await preparedSelect(f);
    const outcomes = await Promise.allSettled([
      coordinateSignalWrite(f.db, f.contributor.sub, request),
      coordinateSignalWrite(f.db, f.contributor.sub, request),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((result) => result.status === "rejected"))
      .toMatchObject({ reason: { message: "challenge_consumed" } });
    expect((await baseState(f)).facet_commands).toHaveLength(1);
  });
});
