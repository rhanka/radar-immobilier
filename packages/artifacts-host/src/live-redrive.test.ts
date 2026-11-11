import type { LiveRedriveItem } from "@sentropic/artifacts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_REDRIVE_INTERVAL_MS, startLiveRedriveLoop, type ShutdownSignals } from "./live-redrive.js";

const ITEM = { storageScopeId: "scope", artifactId: "11111111-1111-4111-8111-111111111111", bindingGeneration: 1,
  action: "project" as const };

function fakeSignals(extraListeners = 0) {
  let listener: (() => void) | undefined;
  const kill = vi.fn();
  const signals: ShutdownSignals = {
    pid: 4242,
    once: (_signal, next) => { listener = next; },
    removeListener: (_signal, next) => { if (listener === next) listener = undefined; },
    listenerCount: () => (listener ? 1 : 0) + extraListeners,
    kill,
  };
  // Node removes a `once` listener before calling it.
  const sigterm = () => { const next = listener; listener = undefined; next?.(); };
  return { signals, kill, sigterm, registered: () => listener !== undefined };
}

describe("live re-drive loop (0.2.27 durable re-drive)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("runs one pass at boot, then one every 15 s, so a pending start is settled again well within 60 s", async () => {
    const redrive = vi.fn(async (): Promise<LiveRedriveItem[]> => []);
    const { signals } = fakeSignals();
    const loop = startLiveRedriveLoop({ redrive, signals, log: () => {} });
    expect(LIVE_REDRIVE_INTERVAL_MS).toBe(15_000);
    expect(redrive).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(redrive).toHaveBeenCalledTimes(5);
    loop.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(redrive).toHaveBeenCalledTimes(5);
  });

  it("never overlaps a pass still in flight and logs one structured summary per non-empty pass", async () => {
    let release: (items: LiveRedriveItem[]) => void = () => {};
    const redrive = vi.fn(() => new Promise<LiveRedriveItem[]>((resolve) => { release = resolve; }));
    const lines: string[] = [];
    const { signals } = fakeSignals();
    const loop = startLiveRedriveLoop({ redrive, signals, log: (line) => lines.push(line) });
    await vi.advanceTimersByTimeAsync(45_000);
    expect(redrive).toHaveBeenCalledTimes(1);
    release([{ ...ITEM, outcome: "settled" }, { ...ITEM, artifactId: "a2", outcome: "pending" },
      { ...ITEM, artifactId: "a3", outcome: "failed" }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(lines.map((line) => JSON.parse(line))).toEqual([{ kind: "artifacts.live_redrive", items: 3, settled: 1, pending: 1,
      failed: 1, skipped: 0 }]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(redrive).toHaveBeenCalledTimes(2);
    loop.stop();
  });

  it("logs a failed pass and reports it without stopping the timer", async () => {
    const failure = new Error("store down");
    const redrive = vi.fn(async (): Promise<LiveRedriveItem[]> => { throw failure; });
    const lines: string[] = [];
    const onError = vi.fn();
    const { signals } = fakeSignals();
    const loop = startLiveRedriveLoop({ redrive, signals, log: (line) => lines.push(line), onError });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(lines).toEqual(Array(2).fill(JSON.stringify({ kind: "artifacts.live_redrive_unavailable" })));
    loop.stop();
  });

  it("on SIGTERM stops the timer, drains the pass in flight, then re-raises the signal for the default exit", async () => {
    let release: (items: LiveRedriveItem[]) => void = () => {};
    const redrive = vi.fn(() => new Promise<LiveRedriveItem[]>((resolve) => { release = resolve; }));
    const { signals, kill, sigterm } = fakeSignals();
    const lines: string[] = [];
    startLiveRedriveLoop({ redrive, signals, log: (line) => lines.push(line) });
    sigterm();
    expect(lines).toContain(JSON.stringify({ kind: "artifacts.live_redrive_draining" }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(kill).not.toHaveBeenCalled();
    release([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(kill).toHaveBeenCalledWith(4242, "SIGTERM");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(redrive).toHaveBeenCalledTimes(1);
  });

  it("bounds the drain, and leaves the exit to another SIGTERM listener when one remains", async () => {
    const redrive = vi.fn(() => new Promise<LiveRedriveItem[]>(() => {}));
    const bounded = fakeSignals();
    startLiveRedriveLoop({ redrive, signals: bounded.signals, log: () => {}, drainTimeoutMs: 1_000 });
    bounded.sigterm();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(bounded.kill).toHaveBeenCalledWith(4242, "SIGTERM");
    const shared = fakeSignals(1);
    startLiveRedriveLoop({ redrive: async () => [], signals: shared.signals, log: () => {} });
    shared.sigterm();
    await vi.advanceTimersByTimeAsync(0);
    expect(shared.kill).not.toHaveBeenCalled();
  });

  it("removes its SIGTERM handler on close", () => {
    const { signals, registered } = fakeSignals();
    const loop = startLiveRedriveLoop({ redrive: async () => [], signals, log: () => {} });
    expect(registered()).toBe(true);
    loop.stop();
    expect(registered()).toBe(false);
  });
});
