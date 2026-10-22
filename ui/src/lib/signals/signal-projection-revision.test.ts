/**
 * 6L1 UI reconciliation: only a successful coherent read against the live
 * viewer incarnation and workspace acknowledges a token. Superseded or
 * failed reads retain the last acknowledged snapshot.
 */
import { describe, expect, it } from "vitest";
import {
  createProjectionSync,
  beginProjectionRead,
  noteProjectionSuccess,
  observeProjection,
  retainedSnapshot,
  shouldReconcile,
  type ProjectionSyncState,
  type ProjectionContext,
} from "./signal-projection-revision.js";

const workspace = "11111111-1111-1111-1111-111111111111";
const otherWorkspace = "22222222-2222-2222-2222-222222222222";

function context(label: string, workspaceId: string | null): ProjectionContext {
  return { viewerKey: { context: label }, workspaceId, citySlug: "synthetic-city", mode: "signal" };
}

function live(state: ProjectionSyncState): ProjectionContext {
  return state.launched;
}

describe("shouldReconcile", () => {
  it("requests a reload only when the remote token differs", () => {
    const state = createProjectionSync(context("viewer-1", workspace));
    expect(shouldReconcile(state, "token-a")).toBe(true);
    noteProjectionSuccess(state, live(state), { token: "token-a" }, beginProjectionRead(state));
    expect(shouldReconcile(state, "token-a")).toBe(false);
    expect(shouldReconcile(state, "token-b")).toBe(true);
  });
});

describe("noteProjectionSuccess", () => {
  it("acknowledges a coherent read against the live context", () => {
    const state = createProjectionSync(context("viewer-1", workspace));
    expect(noteProjectionSuccess(state, live(state), { token: "token-a" }, beginProjectionRead(state))).toBe(true);
    expect(retainedSnapshot(state)).toEqual({ token: "token-a" });
  });

  it("ignores a late response after a viewer transition", () => {
    const state = createProjectionSync(context("viewer-1", workspace));
    noteProjectionSuccess(state, live(state), { token: "token-a" }, beginProjectionRead(state));
    const reconnected = context("viewer-1", workspace);
    expect(noteProjectionSuccess(state, reconnected, { token: "token-b" }, beginProjectionRead(state))).toBe(false);
    expect(retainedSnapshot(state)).toEqual({ token: "token-a" });
    expect(shouldReconcile(state, "token-b")).toBe(true);
  });

  it("ignores a late response after a reconnection to the same account", () => {
    const launched = context("account-a", workspace);
    const state = createProjectionSync(launched);
    const reconnected = context("account-a", workspace);
    expect(noteProjectionSuccess(state, reconnected, { token: "token-a" }, beginProjectionRead(state))).toBe(false);
    expect(retainedSnapshot(state)).toBeNull();
  });

  it("ignores a late response after a workspace switch", () => {
    const incarnation = { context: "viewer-1" };
    const state = createProjectionSync({ ...context("viewer-1", workspace), viewerKey: incarnation });
    const switched = { ...state.launched, workspaceId: otherWorkspace };
    expect(noteProjectionSuccess(state, switched, { token: "token-a" }, beginProjectionRead(state))).toBe(false);
    expect(retainedSnapshot(state)).toBeNull();
  });

  it("retains the snapshot when no read has succeeded", () => {
    const state = createProjectionSync(context("viewer-1", workspace));
    expect(retainedSnapshot(state)).toBeNull();
    expect(shouldReconcile(state, "token-a")).toBe(true);
  });
});

describe("observeProjection refresh", () => {
  function fakeTarget(): Window {
    const noop = () => {};
    return {
      addEventListener: noop,
      removeEventListener: noop,
      document: { addEventListener: noop, removeEventListener: noop, visibilityState: "hidden" },
    } as unknown as Window;
  }

  it("rebuilds the acknowledged snapshot while the context stays live", async () => {
    const state = createProjectionSync(context("viewer-1", workspace));
    let rebuilt: { token: string } | null = null;
    const { refresh } = observeProjection(state, () => state.launched,
      async () => ({ token: "token-a" }),
      (snapshot) => { rebuilt = snapshot; }, fakeTarget());
    await refresh();
    expect(rebuilt).toEqual({ token: "token-a" });
  });

  it.each(["disposal", "account switch"])("skips rebuild when %s lands between fetch and resume", async (transition) => {
    const launched = context("viewer-1", workspace);
    const state = createProjectionSync(launched);
    let current = launched;
    let disposeFn: () => void = () => {};
    let rebuilt: unknown = null;
    const { refresh, dispose } = observeProjection(state, () => current,
      async () => {
        // The transition lands after the fetch resolves but before
        // the synchronous validation applies anything, so nothing is acked.
        queueMicrotask(() => {
          if (transition === "account switch") current = context("viewer-2", workspace);
          else disposeFn();
        });
        return { token: "token-new" };
      },
      (snapshot) => { rebuilt = snapshot; }, fakeTarget());
    disposeFn = dispose;
    await refresh();
    expect(rebuilt).toBeNull();
    expect(retainedSnapshot(state)).toBeNull();
    expect(shouldReconcile(state, "token-new")).toBe(true);
  });

  it("retains the old display and acknowledgment when a superseded read drops then the next read fails", async () => {
    const state = createProjectionSync(context("viewer-1", workspace));
    noteProjectionSuccess(state, live(state), { token: "token-old" }, beginProjectionRead(state));
    let rebuilt: { token: string } | null = null;
    let resolveA!: (snapshot: { token: string }) => void;
    let rejectB!: (reason: unknown) => void;
    let calls = 0;
    const fetch = (): Promise<{ token: string }> => {
      calls += 1;
      if (calls === 1) return new Promise((resolve) => { resolveA = resolve; });
      return new Promise((_, reject) => { rejectB = reject; });
    };
    const { refresh } = observeProjection(state, () => state.launched,
      fetch, (snapshot) => { rebuilt = snapshot; }, fakeTarget());
    const pendingA = refresh();
    resolveA({ token: "token-a" });
    const pendingB = refresh();
    await pendingA;
    expect(rebuilt).toBeNull();
    expect(retainedSnapshot(state)).toEqual({ token: "token-old" });
    expect(state.ackedToken).toBe("token-old");
    rejectB(new Error("offline"));
    await expect(pendingB).rejects.toThrow("offline");
    expect(rebuilt).toBeNull();
    expect(retainedSnapshot(state)).toEqual({ token: "token-old" });
    expect(state.ackedToken).toBe("token-old");
    expect(shouldReconcile(state, "token-a")).toBe(true);
  });

  it.each(["disposal", "account switch"])("never rebuilds after %s queued during validation", async (transition) => {
    const state = createProjectionSync(context("viewer-1", workspace));
    let current = state.launched;
    let invalidated = false;
    let lateRebuild: unknown = null;
    const { refresh, dispose } = observeProjection(state, () => {
      queueMicrotask(() => {
        invalidated = true;
        if (transition === "account switch") current = context("viewer-2", workspace);
        else dispose();
      });
      return current;
    }, async () => ({ token: "token-a" }), (snapshot) => {
      if (invalidated) lateRebuild = snapshot;
    }, fakeTarget());
    await refresh();
    expect(invalidated).toBe(true);
    expect(lateRebuild).toBeNull();
  });

  it("keeps the displayed revision retryable when a read starts after validation and fails", async () => {
    const state = createProjectionSync(context("viewer-1", workspace));
    let displayed = { token: "token-old" };
    noteProjectionSuccess(state, live(state), displayed, beginProjectionRead(state));
    let pendingB!: Promise<void>;
    let rejectB!: (reason: Error) => void;
    let calls = 0;
    let validated = false;
    const { refresh } = observeProjection(state, () => {
      if (!validated) {
        validated = true;
        // In the regression, A is acknowledged here, then B supersedes it
        // before refresh resumes. Atomic application displays A before B.
        queueMicrotask(() => { pendingB = refresh(); });
      }
      return state.launched;
    }, () => ++calls === 1 ? Promise.resolve({ token: "token-a" })
      : new Promise<{ token: string }>((_, reject) => { rejectB = reject; }),
    (snapshot) => { displayed = snapshot; }, fakeTarget());
    await refresh();
    expect(calls).toBe(2);
    rejectB(new Error("offline"));
    await expect(pendingB).rejects.toThrow("offline");
    // A discarded by the final guard must remain retryable. A displayed
    // synchronously before B starts is already acknowledged and up to date.
    expect(shouldReconcile(state, "token-a")).toBe(displayed.token !== "token-a");
    expect(state.ackedToken).toBe(displayed.token);
    expect(retainedSnapshot(state)).toEqual(displayed);
  });
});
