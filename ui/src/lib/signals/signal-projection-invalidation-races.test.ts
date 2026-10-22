import { describe, expect, it, vi } from "vitest";
import { createProjectionInvalidationSync, parseProjectionStreamEvent, type StreamEvent } from "./signal-projection-invalidation.js";
import { observeProjectionInvalidation } from "./signal-projection-invalidation-observer.js";
import { beginProjectionRead, noteProjectionSuccess, retainedSnapshot } from "./signal-projection-revision.js";

function setup(fetchCoherent = async () => ({ token: "synthetic-token" }), useClock = false) {
  const state = createProjectionInvalidationSync({ viewerKey: { context: "synthetic" },
    workspaceId: "11111111-1111-4111-8111-111111111111", citySlug: "synthetic", mode: "signal" }, { enabled: true });
  const callbacks: { onEvent: (event: StreamEvent | null) => void; onError: () => void }[] = [];
  const scheduled: { run: () => void; cancel: ReturnType<typeof vi.fn> }[] = [];
  const rebuild = vi.fn();
  const onClosed = vi.fn();
  const close = vi.fn();
  const observer = observeProjectionInvalidation(state, { live: () => state.launched,
    fetchCoherent, rebuild, onClosed, createSource: (_url, handlers) => {
      callbacks.push(handlers); return { close }; },
    schedule: (run, delay) => {
      const timer = useClock ? setTimeout(run, delay) : null;
      const job = { run, cancel: vi.fn(() => { if (timer !== null) clearTimeout(timer); }) };
      scheduled.push(job); return job;
    } });
  return { state, callbacks, scheduled, rebuild, onClosed, close, observer };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
describe("6L2 pending refetch guards", () => {
  it("should share the coherent snapshot and acknowledgment with 6L1", async () => {
    const fetch = vi.fn(async () => ({ token: "synthetic-token" }));
    const h = setup(fetch);
    noteProjectionSuccess(h.state, h.state.launched, { token: "prior" }, beginProjectionRead(h.state));
    h.callbacks[0]!.onEvent({ kind: "invalidated", token: "prior" });
    expect(fetch).not.toHaveBeenCalled();
    h.callbacks[0]!.onEvent({ kind: "invalidated", token: "synthetic-token" });
    await flush();
    expect(retainedSnapshot(h.state)).toEqual({ token: "synthetic-token" });
    h.callbacks[0]!.onEvent({ kind: "closed" });
    expect(retainedSnapshot(h.state)).toBeNull();
  });
  it("should prevent pending refetch acknowledgment after revocation", async () => {
    let resolve!: (value: { token: string }) => void;
    const h = setup(() => new Promise((done) => { resolve = done; }));
    h.callbacks[0]!.onEvent({ kind: "invalidated", token: "synthetic-token" });
    h.callbacks[0]!.onEvent({ kind: "closed" });
    resolve({ token: "synthetic-token" });
    await flush();
    expect(h.rebuild).not.toHaveBeenCalled();
    expect(h.state.ackedToken).toBeNull();
    expect(h.state.launched.viewerKey).toBeNull();
    expect(h.state.launched.workspaceId).toBeNull();
    expect(h.onClosed).toHaveBeenCalledTimes(1);
    h.callbacks[0]!.onError();
    expect(h.scheduled).toHaveLength(0);
  });
  it("should retry failed reloads without another server event or early acknowledgment", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ token: "synthetic-token" });
    const h = setup(fetch);
    h.callbacks[0]!.onEvent({ kind: "invalidated", token: "synthetic-token" });
    await flush();
    expect(h.state.ackedToken).toBeNull();
    expect(h.rebuild).not.toHaveBeenCalled();
    expect(h.scheduled).toHaveLength(1);
    h.scheduled[0]!.run();
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(h.state.ackedToken).toBe("synthetic-token");
    h.observer.dispose();
  });
  it("should clear a revoked context when reconnects overlap deferred denials", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(() => new Promise<{ token: string }>((_resolve, reject) => {
      setTimeout(() => reject({ status: 403 }), 1500);
    }));
    const h = setup(fetch, true);
    try {
      noteProjectionSuccess(h.state, h.state.launched, { token: "prior" }, beginProjectionRead(h.state));
      h.state.cursor = "prior-cursor";
      h.callbacks[0]!.onError();
      await vi.advanceTimersByTimeAsync(1000);
      h.callbacks[1]!.onError();
      await vi.advanceTimersByTimeAsync(500);
      expect(h.onClosed).toHaveBeenCalledTimes(1);
      expect(h.state.enabled).toBe(false);
      expect(h.state.launched.viewerKey).toBeNull();
      expect(h.state.launched.workspaceId).toBeNull();
      expect(h.state.ackedToken).toBeNull();
      expect(h.state.cursor).toBeNull();
      expect(retainedSnapshot(h.state)).toBeNull();
      expect(h.rebuild).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5000);
      expect(h.callbacks).toHaveLength(2);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      for (const job of h.scheduled) expect(job.cancel).toHaveBeenCalled();
    } finally { h.observer.dispose(); vi.useRealTimers(); }
  });
  it("should clear authorization failures instead of retrying them", async () => {
    const h = setup(async () => { throw { status: 403 }; });
    h.callbacks[0]!.onEvent({ kind: "resync" });
    await flush();
    expect(h.onClosed).toHaveBeenCalledTimes(1);
    expect(h.state.enabled).toBe(false);
    expect(h.scheduled).toHaveLength(0);
  });
  it("should clear denied reconnects when EventSource exposes only an error", async () => {
    const h = setup(async () => { throw { status: 403 }; });
    h.callbacks[0]!.onError();
    await flush();
    expect(h.onClosed).toHaveBeenCalledTimes(1);
    expect(h.state.launched.viewerKey).toBeNull();
    expect(h.scheduled[0]!.cancel).toHaveBeenCalled();
  });
  it("should ignore stale source events and all work after disposal", async () => {
    const fetch = vi.fn(async () => ({ token: "synthetic-token" }));
    const h = setup(fetch);
    h.callbacks[0]!.onError();
    await flush();
    fetch.mockClear();
    h.scheduled[0]!.run();
    h.callbacks[0]!.onEvent({ kind: "closed" });
    expect(h.onClosed).not.toHaveBeenCalled();
    h.observer.dispose();
    h.callbacks[1]!.onEvent({ kind: "resync" });
    await h.observer.refresh();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("should reject null and scalar frame payloads", () => {
    expect(parseProjectionStreamEvent("invalidated", "null")).toBeNull();
    expect(parseProjectionStreamEvent("invalidated", "42")).toBeNull();
  });
});
