import type { LiveRedriveItem } from "@sentropic/artifacts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_REDRIVE_INTERVAL_MS, startLiveRedriveLoop, type ShutdownSignals } from "./live-redrive.js";

const ITEM = { storageScopeId: "scope", artifactId: "11111111-1111-4111-8111-111111111111", bindingGeneration: 1,
  action: "project" as const };

function fakeSignals() {
  let listener: (() => void) | undefined;
  const signals: ShutdownSignals = {
    once: (_signal, next) => { listener = next; },
    removeListener: (_signal, next) => { if (listener === next) listener = undefined; },
  };
  // Node removes a `once` listener before calling it.
  const sigterm = () => { const next = listener; listener = undefined; next?.(); };
  return { signals, sigterm, registered: () => listener !== undefined };
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

  it("on SIGTERM only stops the timer: the pass in flight finishes, no new pass starts, the process is never exited",
    async () => {
      let release: (items: LiveRedriveItem[]) => void = () => {};
      const redrive = vi.fn(() => new Promise<LiveRedriveItem[]>((resolve) => { release = resolve; }));
      const { signals, sigterm } = fakeSignals();
      const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
      const lines: string[] = [];
      startLiveRedriveLoop({ redrive, signals, log: (line) => lines.push(line) });
      sigterm();
      expect(lines).toEqual([JSON.stringify({ kind: "artifacts.live_redrive_stopped", passInFlight: true })]);
      release([{ ...ITEM, outcome: "settled" }]);
      await vi.advanceTimersByTimeAsync(0);
      expect(lines.at(-1)).toBe(JSON.stringify({ kind: "artifacts.live_redrive", items: 1, settled: 1, pending: 0, failed: 0,
        skipped: 0 }));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(redrive).toHaveBeenCalledTimes(1);
      expect(exit).not.toHaveBeenCalled();
      exit.mockRestore();
    });

  it("removes its SIGTERM handler on close", () => {
    const { signals, registered } = fakeSignals();
    const loop = startLiveRedriveLoop({ redrive: async () => [], signals, log: () => {} });
    expect(registered()).toBe(true);
    loop.stop();
    expect(registered()).toBe(false);
  });
});
