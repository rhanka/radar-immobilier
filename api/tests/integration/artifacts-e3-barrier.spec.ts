import { afterEach, describe, expect, it, vi } from "vitest";
import { startCorrelatedBarrier } from "./artifacts-e3-barrier.helpers.js";
import type { CommitBarrier, InvocationContextShape } from "./artifacts-provider-contract.helpers.js";

const point = "before_commit";
const invocation = { invocationId: "late-e3" } as InvocationContextShape;
const cleanups: Array<() => void> = [];

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((ok) => { resolve = ok; });
  return { promise, resolve };
}

/** A controlled gate tests helper cleanup without executing provider operations. */
function gate() {
  const arrival = deferred();
  const resume = deferred();
  const release = vi.fn(() => resume.resolve());
  cleanups.push(resume.resolve);
  const barrier: CommitBarrier = {
    observer: undefined,
    waitUntilReached: () => arrival.promise,
    release,
  };
  return { barrier, release, arrive: arrival.resolve, resumed: resume.promise };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
});

describe("correlated E3 cleanup", () => {
  it("releases a reached invocation exactly once", async () => {
    const pause = gate();
    const run = startCorrelatedBarrier(pause.barrier, point, async (register) => {
      register(invocation); pause.arrive(); await pause.resumed;
    });
    await run.reached;
    run.release(); run.release();
    await run.pending;
    expect(pause.release).toHaveBeenCalledExactlyOnceWith(point, invocation.invocationId);
  });

  it.each([false, true])("fails on timeout and drains a late arrival (finally release=%s)", async (finallyRelease) => {
    vi.useFakeTimers();
    const pause = gate();
    const dispatch = deferred();
    const run = startCorrelatedBarrier(pause.barrier, point, async (register) => {
      register(invocation); await dispatch.promise; pause.arrive(); await pause.resumed;
    });
    const expired = expect(run.reached).rejects.toThrow("[barrier-timeout] before_commit/late-e3");
    await vi.advanceTimersByTimeAsync(1000);
    await expired;
    if (finallyRelease) { run.release(); run.release(); }
    dispatch.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(pause.release).toHaveBeenCalledExactlyOnceWith(point, invocation.invocationId);
    await run.pending;
    run.release();
    expect(pause.release).toHaveBeenCalledTimes(1);
  });

  it("remembers cleanup requested before transport registration", async () => {
    const pause = gate();
    const dispatch = deferred();
    const run = startCorrelatedBarrier(pause.barrier, point, async (register) => {
      await dispatch.promise; register(invocation); pause.arrive(); await pause.resumed;
    });
    run.release(); dispatch.resolve();
    await run.reached;
    expect(pause.release).toHaveBeenCalledTimes(1);
    await run.pending;
  });

  it("rejects a failed transport and drains its later barrier arrival", async () => {
    const pause = gate();
    const failure = new Error("transport failed after dispatch");
    const run = startCorrelatedBarrier(pause.barrier, point, async (register) => {
      register(invocation); throw failure;
    });
    await expect(run.pending).rejects.toBe(failure);
    await expect(run.reached).rejects.toBe(failure);
    pause.arrive();
    await Promise.resolve(); await Promise.resolve();
    expect(pause.release).toHaveBeenCalledExactlyOnceWith(point, invocation.invocationId);
    run.release();
    expect(pause.release).toHaveBeenCalledTimes(1);
  });
});
