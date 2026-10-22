import { describe, expect, it, vi } from "vitest";
import {
  createProjectionSync, reconcileProjection, observeProjection,
  type ProjectionContext,
} from "./signal-projection-revision.js";

const context = (): ProjectionContext => ({ viewerKey: { context: "synthetic-viewer" },
  workspaceId: "synthetic-workspace", citySlug: "synthetic-city", mode: "signal" });

describe("6L1 projection request lifecycle", () => {
  it("should ignore superseded requests within the same context", async () => {
    const live = context();
    const state = createProjectionSync(live);
    let finish!: (value: { token: string }) => void;
    const old = reconcileProjection(state, () => live,
      () => new Promise((resolve) => { finish = resolve; }));
    expect(await reconcileProjection(state, () => live, async () => ({ token: "new" }))).toBe(true);
    finish({ token: "old" });
    expect(await old).toBe(false);
    expect(state.snapshot).toEqual({ token: "new" });
    expect(state.ackedToken).toBe("new");
  });

  it.each(["citySlug", "mode"] as const)("should ignore responses after a %s switch", async (key) => {
    const live = context();
    const state = createProjectionSync(live);
    expect(await reconcileProjection(state, () => ({ ...live, [key]: "other" }),
      async () => ({ token: "old-context" }))).toBe(false);
    expect(state.snapshot).toBeNull();
  });

  it("should retain the complete snapshot on failure and permit retry", async () => {
    const live = context();
    const state = createProjectionSync<{ token: string; heads: string[]; detail: string; count: number }>(live);
    const snapshot = { token: "a", heads: ["head"], detail: "evidence", count: 1 };
    await reconcileProjection(state, () => live, async () => snapshot);
    await expect(reconcileProjection(state, () => live, async () => { throw new Error("offline"); }))
      .rejects.toThrow("offline");
    expect(state.snapshot).toBe(snapshot);
    expect(state.ackedToken).toBe("a");
    const replacement = { token: "b", heads: [], detail: "updated evidence", count: 0 };
    await reconcileProjection(state, () => live, async () => replacement);
    expect(state.snapshot).toBe(replacement);
  });

  it("should reconcile local changes, focus, visibility, and reconnection", async () => {
    const live = context();
    const state = createProjectionSync(live);
    let revision = 0;
    const fetch = vi.fn(async () => ({ token: `revision-${++revision}` }));
    const rebuild = vi.fn();
    const observer = observeProjection(state, () => live, fetch, rebuild);
    await observer.refresh();
    for (const event of ["focus", "online", "pageshow"]) window.dispatchEvent(new Event(event));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(rebuild).toHaveBeenLastCalledWith(state.snapshot);
    observer.dispose();
    window.dispatchEvent(new Event("focus"));
    expect(fetch).toHaveBeenCalledTimes(5);
  });
});
