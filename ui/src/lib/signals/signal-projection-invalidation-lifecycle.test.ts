// Synthetic sources qualify independent tabs, reconnects and failed refetches.
import { describe, expect, it, vi } from "vitest";
import {
  createProjectionInvalidationSync,
  type ProjectionInvalidationContext,
  type ProjectionInvalidationSync,
  type StreamEvent,
} from "./signal-projection-invalidation.js";
import {
  observeProjectionInvalidation,
  type ProjectionEventSource,
} from "./signal-projection-invalidation-observer.js";

const workspace = "11111111-1111-1111-1111-111111111111";

function context(label: string): ProjectionInvalidationContext {
  return { viewerKey: { context: label }, workspaceId: workspace,
    citySlug: "synthetic-city", mode: "signal" };
}

interface FakeSource extends ProjectionEventSource {
  url: string;
  emit: (streamEvent: StreamEvent | null) => void;
  fail: () => void;
  closed: boolean;
}

function fakeFactory(sources: FakeSource[]) {
  return (url: string, handlers: {
    onEvent: (streamEvent: StreamEvent | null) => void; onError: () => void;
  }): ProjectionEventSource => {
    const source: FakeSource = { url, closed: false,
      emit: (streamEvent) => handlers.onEvent(streamEvent),
      fail: () => handlers.onError(),
      close: () => { source.closed = true; } };
    sources.push(source);
    return source;
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function harness(state: ProjectionInvalidationSync, fetchCoherent?: () => Promise<{ token: string }>) {
  const sources: FakeSource[] = [];
  const liveRef = { current: state.launched };
  const fetch = vi.fn(fetchCoherent ?? (async () => ({ token: "token-a" })));
  const rebuild = vi.fn();
  const onClosed = vi.fn(() => {
    liveRef.current = { viewerKey: null, workspaceId: null, citySlug: "synthetic-city", mode: "signal" }; });
  const observer = observeProjectionInvalidation(state, { live: () => liveRef.current,
    fetchCoherent: fetch, rebuild, onClosed, createSource: fakeFactory(sources),
    schedule: (run) => {
      const timer = setTimeout(run, 0);
      return { cancel: () => clearTimeout(timer) };
    } });
  return { sources, fetch, rebuild, onClosed, observer, liveRef };
}

describe("6L2 invalidation observer", () => {
  it("should open no source while the gate is closed", () => {
    const state = createProjectionInvalidationSync(context("viewer-1"));
    const { sources, observer } = harness(state);
    expect(sources).toHaveLength(0);
    observer.dispose();
  });

  it("should reconcile two tabs independently on a shared invalidation", async () => {
    const first = createProjectionInvalidationSync(context("viewer-1"), { enabled: true });
    const second = createProjectionInvalidationSync(context("viewer-1"), { enabled: true });
    const left = harness(first);
    const right = harness(second);
    left.sources[0]!.emit({ kind: "invalidated", token: "token-shared" });
    right.sources[0]!.emit({ kind: "invalidated", token: "token-shared" });
    await tick();
    expect(left.fetch).toHaveBeenCalledTimes(1);
    expect(right.fetch).toHaveBeenCalledTimes(1);
    expect(first.ackedToken).toBe("token-a");
    left.observer.dispose();
    right.observer.dispose();
  });

  it("should clear the context through the authorization path on revocation", async () => {
    const state = createProjectionInvalidationSync(context("viewer-1"), { enabled: true });
    const { sources, onClosed, rebuild, observer } = harness(state);
    sources[0]!.emit({ kind: "closed" });
    await tick();
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(sources[0]!.closed).toBe(true);
    expect(rebuild).not.toHaveBeenCalled();
    expect(state.ackedToken).toBeNull();
    observer.dispose();
  });

  it("should resynchronize on restart and reconnect cleanly on a lost cursor", async () => {
    const state = createProjectionInvalidationSync(context("viewer-1"),
      { enabled: true, cursor: "cursor-stale" });
    const { sources, rebuild, observer } = harness(state);
    expect(sources[0]!.url).toContain("cursor=cursor-stale");
    sources[0]!.emit({ kind: "resync", token: "token-b", cursor: "cursor-fresh" });
    await tick();
    expect(rebuild).toHaveBeenCalledWith({ token: "token-a" });
    expect(state.cursor).toBe("cursor-fresh");
    state.cursor = null;
    sources[0]!.fail();
    await tick();
    await tick();
    expect(sources).toHaveLength(2);
    expect(sources[1]!.url).not.toContain("cursor=");
    observer.dispose();
  });

  it("should ignore a late response after a context switch", async () => {
    const state = createProjectionInvalidationSync(context("viewer-1"), { enabled: true });
    let resolveFetch!: (snapshot: { token: string }) => void;
    const { sources, rebuild, liveRef, observer } = harness(state,
      () => new Promise((resolve) => { resolveFetch = resolve; }));
    sources[0]!.emit({ kind: "invalidated", token: "token-a" });
    await tick();
    liveRef.current = context("viewer-2");
    resolveFetch({ token: "token-a" });
    await tick();
    expect(rebuild).not.toHaveBeenCalled();
    expect(state.ackedToken).toBeNull();
    observer.dispose();
  });

  it("should retain the snapshot when the refetch fails and retry on next event", async () => {
    const state = createProjectionInvalidationSync(context("viewer-1"), { enabled: true });
    let calls = 0;
    const { sources, rebuild, fetch, observer } = harness(state, async () => {
      calls += 1;
      if (calls === 1) throw new Error("offline");
      return { token: "token-a" };
    });
    sources[0]!.emit({ kind: "invalidated", token: "token-a" });
    await tick();
    expect(rebuild).not.toHaveBeenCalled();
    expect(state.ackedToken).toBeNull();
    sources[0]!.emit({ kind: "invalidated", token: "token-a" });
    await tick();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(rebuild).toHaveBeenCalledWith({ token: "token-a" });
    expect(state.ackedToken).toBe("token-a");
    observer.dispose();
  });
});
