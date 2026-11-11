import type { LiveWorkerPort } from "@sentropic/artifacts";
import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";
import { describe, expect, it } from "vitest";
import { createRedrivingLiveWorker, withLiveWorkerLogging, type LiveWorkerLogLine } from "./live-worker-redrive.js";

const IDENTITY = { storageScopeId: "radar-immobilier-test", artifactId: "11111111-1111-4111-8111-111111111111", bindingGeneration: 1 };
const ack = (ready: boolean, revision = "r1") => ({ liveSessionId: "s1", leaseEpoch: 1, routeEpoch: 1, revision, ready });
type Step = ReturnType<typeof ack> | Error;

function harness(steps: Step[], extra: Parameters<typeof createRedrivingLiveWorker>[1] = {}) {
  const lines: LiveWorkerLogLine[] = [];
  const sleeps: number[] = [];
  let clock = 0;
  let calls = 0;
  const inner: LiveWorkerPort = {
    async reconcile() {
      const step = steps[Math.min(calls, steps.length - 1)]!;
      calls += 1;
      if (step instanceof Error) throw step;
      return step;
    },
    async stop() { throw new ArtifactOperationError("provider_unavailable"); },
  };
  const worker = createRedrivingLiveWorker(inner, { log: (line) => lines.push(line), now: () => clock,
    sleep: async (ms) => { sleeps.push(ms); clock += ms; }, ...extra });
  return { worker, lines, sleeps, calls: () => calls };
}

describe("redriving live worker", () => {
  it("passes a ready ack through with no log and no second call", async () => {
    const h = harness([ack(true)]);
    await expect(h.worker.reconcile(IDENTITY)).resolves.toEqual(ack(true));
    expect(h.calls()).toBe(1);
    expect(h.lines).toEqual([]);
  });

  it("polls a not-ready builder until it is ready and logs pending then ready", async () => {
    const h = harness([ack(false), ack(false), ack(true)]);
    await expect(h.worker.reconcile(IDENTITY)).resolves.toEqual(ack(true));
    expect(h.calls()).toBe(3);
    expect(h.sleeps).toEqual([2_000, 2_000]);
    expect(h.lines.map((line) => line.kind)).toEqual(["artifacts.live_worker_pending", "artifacts.live_worker_ready"]);
    expect(h.lines[1]).toMatchObject({ operation: "reconcile", artifactId: IDENTITY.artifactId, bindingGeneration: 1, polls: 2,
      elapsedMs: 4_000, terminal: true });
  });

  it("retries a refusal with backoff, logs each failure with its typed code, then recovers", async () => {
    const h = harness([new ArtifactOperationError("provider_unavailable"), new ArtifactOperationError("provider_unavailable"), ack(true)]);
    await expect(h.worker.reconcile(IDENTITY)).resolves.toEqual(ack(true));
    expect(h.sleeps).toEqual([5_000, 15_000]);
    expect(h.lines).toEqual([
      expect.objectContaining({ kind: "artifacts.live_worker_failed", code: "provider_unavailable", attempt: 1, terminal: false }),
      expect.objectContaining({ kind: "artifacts.live_worker_failed", code: "provider_unavailable", attempt: 2, terminal: false }),
    ]);
  });

  it("rethrows the unchanged refusal after 5 consecutive failures within 5 minutes, with a terminal log", async () => {
    const refusal = new ArtifactOperationError("builder_unavailable");
    const h = harness([refusal]);
    await expect(h.worker.reconcile(IDENTITY)).rejects.toBe(refusal);
    expect(h.calls()).toBe(5);
    expect(h.sleeps.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(5 * 60_000);
    expect(h.lines).toHaveLength(5);
    expect(h.lines[4]).toMatchObject({ kind: "artifacts.live_worker_failed", code: "builder_unavailable", attempt: 5, terminal: true,
      reason: "max_failures" });
  });

  it("stops polling at the not-ready deadline with a terminal log and returns the last ack", async () => {
    const h = harness([ack(false)], { notReadyDeadlineMs: 5_000 });
    await expect(h.worker.reconcile(IDENTITY)).resolves.toEqual(ack(false));
    expect(h.calls()).toBe(4);
    expect(h.lines.at(-1)).toMatchObject({ kind: "artifacts.live_worker_abandoned", reason: "not_ready_deadline", terminal: true });
  });

  it("stops polling once the session no longer waits (stopped or settled elsewhere)", async () => {
    let waiting = true;
    const h = harness([ack(false)], { waiting: async () => waiting });
    const pending = h.worker.reconcile(IDENTITY);
    waiting = false;
    await expect(pending).resolves.toEqual(ack(false));
    expect(h.calls()).toBe(1);
    expect(h.lines.at(-1)).toMatchObject({ kind: "artifacts.live_worker_abandoned", reason: "session_not_waiting", terminal: true });
  });

  it("joins concurrent callers of one binding generation onto a single poll", async () => {
    const h = harness([ack(false), ack(true, "r2")]);
    const [first, second] = await Promise.all([h.worker.reconcile(IDENTITY), h.worker.reconcile(IDENTITY)]);
    expect(first).toEqual(ack(true, "r2"));
    expect(second).toEqual(ack(true, "r2"));
    expect(h.calls()).toBe(2);
    await expect(h.worker.reconcile(IDENTITY)).resolves.toEqual(ack(true, "r2"));
    expect(h.calls()).toBe(3);
  });

  it("logs a stop failure with its typed code and rethrows it", async () => {
    const h = harness([ack(true)]);
    await expect(h.worker.stop({ ...IDENTITY, liveSessionId: "s1", leaseEpoch: 1 })).rejects.toMatchObject({ kind: "provider_unavailable" });
    expect(h.lines).toEqual([expect.objectContaining({ kind: "artifacts.live_worker_failed", operation: "stop",
      code: "provider_unavailable", terminal: true })]);
  });
});

describe("logging-only live worker (request path)", () => {
  it("logs one typed line and rethrows without retrying", async () => {
    const lines: LiveWorkerLogLine[] = [];
    let calls = 0;
    const refusal = new ArtifactOperationError("provider_unavailable");
    const inner: Pick<LiveWorkerPort, "reconcile"> = { async reconcile() { calls += 1; throw refusal; } };
    const worker = withLiveWorkerLogging(inner, { log: (line) => lines.push(line) });
    await expect(worker.reconcile(IDENTITY)).rejects.toBe(refusal);
    expect(calls).toBe(1);
    expect(lines).toEqual([expect.objectContaining({ kind: "artifacts.live_worker_failed", operation: "reconcile",
      code: "provider_unavailable", terminal: true })]);
  });
});
