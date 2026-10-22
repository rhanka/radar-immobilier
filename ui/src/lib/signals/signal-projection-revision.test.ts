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

  it("skips rebuild when disposal and an account switch land between validation and resume", async () => {
    const launched = context("viewer-1", workspace);
    const state = createProjectionSync(launched);
    let current = launched;
    const liveFn = (): ProjectionContext => {
      if (current === launched) {
        // A microtask switches account and disposes after the response
        // validated but before refresh resumes, matching the reported window.
        queueMicrotask(() => {
          current = context("viewer-2", workspace);
          dispose();
        });
      }
      return current;
    };
    let rebuilt: unknown = null;
    const { refresh, dispose } = observeProjection(state, liveFn,
      async () => ({ token: "token-new" }),
      (snapshot) => { rebuilt = snapshot; }, fakeTarget());
    await refresh();
    expect(rebuilt).toBeNull();
  });
});
