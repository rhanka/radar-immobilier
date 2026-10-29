import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { baseState } from "../../src/services/facets/signal-write-fixture.js";
import { backendPid, blockedBy, effects, latch, NO_EFFECTS, ONE_COMMIT, outcome, writeFixture } from "./pwe-fixture.js";

describeDb("PWE-04 C01 concurrent confirmations", () => {
  it("should commit once and refuse the second connection before its writer", async () => {
    const h = await writeFixture();
    const reached = latch();
    const release = latch();
    const port = h.admission();
    const record = port.recordCommit;
    let pid = 0;
    let secondWrites = 0;
    port.recordCommit = async (tx, result) => {
      await record(tx, result); pid = await backendPid(tx);
      reached.resolve(); await release.promise;
    };
    const first = outcome(h.execute(port));
    const secondPort = h.admission();
    const secondRecord = secondPort.recordCommit;
    secondPort.recordCommit = async (tx, result) => {
      secondWrites++; await secondRecord(tx, result);
    };
    let second: typeof first | undefined;
    try {
      await reached.wait();
      expect(await effects(h.f)).toEqual(NO_EFFECTS);
      second = outcome(h.execute(secondPort));
      await blockedBy(h.f, pid);
    } finally { release.resolve(); }
    expect((await first).error).toBeNull();
    expect((await second)?.error).toMatchObject({ message: "challenge_consumed" });
    expect(secondWrites).toBe(0);
    expect(await effects(h.f)).toEqual(ONE_COMMIT);
  });

  it("should roll back the first winner completely and admit the waiting connection once", async () => {
    const h = await writeFixture();
    const before = await baseState(h.f);
    const firstReached = latch();
    const firstRelease = latch();
    const secondReached = latch();
    const secondRelease = latch();
    const port = h.admission();
    const record = port.recordCommit;
    let pid = 0;
    port.recordCommit = async (tx, result) => {
      await record(tx, result); pid = await backendPid(tx);
      firstReached.resolve(); await firstRelease.promise;
      throw new Error("PWE rollback after durable writes");
    };
    const first = outcome(h.execute(port));
    const next = h.admission();
    const reserve = next.reserve;
    next.reserve = async (tx, reservation) => {
      await reserve(tx, reservation); secondReached.resolve(); await secondRelease.promise;
    };
    let second: typeof first | undefined;
    try {
      await firstReached.wait();
      second = outcome(h.execute(next));
      await blockedBy(h.f, pid);
      firstRelease.resolve();
      expect((await first).error).toMatchObject({ message: "PWE rollback after durable writes" });
      await secondReached.wait();
      expect(await effects(h.f)).toEqual(NO_EFFECTS);
      expect(await baseState(h.f)).toEqual(before);
    } finally { firstRelease.resolve(); secondRelease.resolve(); }
    expect((await second)?.error).toBeNull();
    expect(await effects(h.f)).toEqual(ONE_COMMIT);
  });
});
