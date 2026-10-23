import type { ChildProcess } from "node:child_process";
import type { CommitBarrier, CommitBarrierPoint } from "./artifacts-provider-contract.helpers.js";

async function settledWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.then(() => true),
      new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), ms); }),
    ]);
  } finally { clearTimeout(timer); }
}

/** Reap the process even if its close RPC or a leased pool client never settles. */
export async function closeArtifactWorker(child: ChildProcess, requestClose: () => Promise<unknown>): Promise<void> {
  const exited = new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once("exit", () => resolve());
  });
  try { await settledWithin(requestClose(), 5000); } catch { /* child may already have exited */ }
  finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    if (!await settledWithin(exited, 1000)) {
      child.kill("SIGKILL");
      if (!await settledWithin(exited, 1000)) throw new Error("artifact worker did not exit after SIGKILL");
    }
  }
}

/** Observe every rejection, release barriers, then close both hosts within bounds. */
export async function cleanupArtifactRace(
  barriers: ReadonlyArray<{ barrier: CommitBarrier; invocationId: string }>,
  points: readonly CommitBarrierPoint[],
  pending: ReadonlyArray<Promise<unknown> | undefined>,
  closeHost: () => void,
  closeWorker: () => Promise<void>,
): Promise<void> {
  const collected = Promise.allSettled(pending.filter((p): p is Promise<unknown> => p !== undefined));
  try {
    for (const { barrier, invocationId } of barriers) {
      if (!invocationId) continue;
      for (const point of points) {
        try { barrier.release(point, invocationId); } catch { /* continue releasing other barriers */ }
      }
    }
    await settledWithin(collected, 2000);
  } finally {
    try { closeHost(); } finally { await closeWorker(); }
  }
  if (!await settledWithin(collected, 2000)) throw new Error("artifact race operations did not settle during cleanup");
}

/** Only referenced keys must survive; exclusive target bytes must be deleted. */
export function assertPurgeEffects(protectedKeys: readonly string[], exclusiveKeys: readonly string[], after: Set<string>): void {
  if (!protectedKeys.length || !exclusiveKeys.length) throw new Error("purge fixture lacks protected or exclusive bytes");
  for (const key of protectedKeys) {
    if (!after.has(key)) throw new Error("purge deleted a referenced blob");
  }
  for (const key of exclusiveKeys) {
    if (after.has(key)) throw new Error("purge retained an exclusive blob");
  }
}
