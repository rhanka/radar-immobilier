import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBacklogPoller, type BacklogPollerDeps } from "./backlog-poller.js";
import type { BacklogResponse } from "./backlog-client.js";
import type { BacklogItem } from "./backlog-data.js";

const itemA: BacklogItem = {
  id: "a",
  code: "WP4",
  titre: "Item A",
  description: "",
  statut: "realise",
  source: "track",
};
const itemB: BacklogItem = {
  id: "b",
  code: "WP6",
  titre: "Item B",
  description: "",
  statut: "en-cours",
  source: "track",
};

const trackRes = (items: BacklogItem[]): BacklogResponse => ({
  items,
  source: "track",
});

/** Flush pending microtasks (the immediate poll's promise) WITHOUT advancing
 *  any fake timer, so the interval does not tick. */
const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};

/** Build a poller over a fetch stub + a fixed clock, with onState captured. */
function makePoller(
  fetchImpl: () => Promise<BacklogResponse>,
  overrides: Partial<BacklogPollerDeps> = {},
) {
  const states: Array<ReturnType<typeof snapshot>> = [];
  let now = 1_000;
  const deps: BacklogPollerDeps = {
    fetchBacklog: fetchImpl,
    now: () => now,
    intervalMs: 10_000,
    ...overrides,
  };
  const poller = createBacklogPoller(deps);
  poller.subscribe((s) => states.push(snapshot(s)));
  function snapshot(s: ReturnType<typeof poller.getState>) {
    return { items: s.items, source: s.source, loading: s.loading, error: s.error, lastUpdated: s.lastUpdated };
  }
  return { poller, states, advanceClock: (ms: number) => { now += ms; } };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createBacklogPoller", () => {
  it("refreshes immediately on start and exposes the items + source", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(trackRes([itemA]));
    const { poller } = makePoller(fetchImpl);

    poller.start();
    await flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(poller.getState().items).toEqual([itemA]);
    expect(poller.getState().source).toBe("track");
    expect(poller.getState().loading).toBe(false);
    poller.stop();
  });

  it("polls again on each interval tick and reflects new items", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(trackRes([itemA]))
      .mockResolvedValueOnce(trackRes([itemA, itemB]));
    const { poller } = makePoller(fetchImpl);

    poller.start();
    await flush();
    expect(poller.getState().items).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(poller.getState().items).toEqual([itemA, itemB]);
    poller.stop();
  });

  it("stop() clears the interval — no further polls", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(trackRes([itemA]));
    const { poller } = makePoller(fetchImpl);

    poller.start();
    await flush();
    poller.stop();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("pause() halts ticks; resume() restarts polling", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(trackRes([itemA]));
    const { poller } = makePoller(fetchImpl);

    poller.start();
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    poller.pause();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(poller.getState().paused).toBe(true);

    poller.resume();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(poller.getState().paused).toBe(false);
    poller.stop();
  });

  it("refresh() triggers an out-of-band poll and records lastUpdated", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(trackRes([itemA]));
    const { poller } = makePoller(fetchImpl);

    poller.start();
    await flush();
    expect(poller.getState().lastUpdated).toBe(1_000);

    await poller.refresh();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(poller.getState().lastUpdated).toBe(1_000);
    poller.stop();
  });

  it("falls back to the ÉV seed on fetch failure without losing prior items", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(trackRes([itemA, itemB]))
      .mockRejectedValueOnce(new Error("offline"));
    const { poller } = makePoller(fetchImpl);

    poller.start();
    await flush();
    expect(poller.getState().source).toBe("track");

    await vi.advanceTimersByTimeAsync(10_000);
    // On error the poller surfaces an error + ev-fallback source, but keeps the
    // last good items so the board never blanks mid-poll.
    expect(poller.getState().error).not.toBeNull();
    expect(poller.getState().source).toBe("ev-fallback");
    expect(poller.getState().items.length).toBeGreaterThan(0);
    poller.stop();
  });

  it("does not overlap polls: a tick during an in-flight fetch is skipped", async () => {
    let resolveFirst: (v: BacklogResponse) => void = () => {};
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<BacklogResponse>((r) => { resolveFirst = r; }),
      )
      .mockResolvedValue(trackRes([itemA]));
    const { poller } = makePoller(fetchImpl);

    poller.start();
    // First fetch is in-flight (unresolved). A tick lands before it resolves.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    resolveFirst(trackRes([itemB]));
    await vi.runOnlyPendingTimersAsync();
    poller.stop();
  });

  it("notifies subscribers on each state transition", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(trackRes([itemA]));
    const { poller, states } = makePoller(fetchImpl);

    poller.start();
    await flush();
    // At least: initial subscribe snapshot, loading=true, then loaded.
    expect(states.length).toBeGreaterThanOrEqual(2);
    expect(states.at(-1)?.loading).toBe(false);
    poller.stop();
  });
});
