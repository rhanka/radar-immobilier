import { describe, expect, it } from "vitest";
import { pageHarness, statusOf, UUID } from "../../src/artifacts/write-intent-page-harness.js";
import { PW_PAGE_POLL_BOUNDS } from "../../src/artifacts/write-intent-page-gesture.js";

const start = 1_000_000;
const end = start + PW_PAGE_POLL_BOUNDS.windowMs;
const manual = async (h: ReturnType<typeof pageHarness>) => {
  for (const fn of h.elements["pw-write-manual"]!.listeners.click ?? []) fn({});
  await h.flush();
};

describe("PWE-09 C12 page reload budget", () => {
  it("should preserve the fixed budget after reloading the exact served script", async () => {
    const storage = new Map<string, string>();
    const first = pageHarness({ storage }); first.followUp(UUID);
    first.setNow(end); await first.runTimer();
    const next = pageHarness({ storage, initialNow: end });
    next.responders.push(() => statusOf(UUID, "pending")); next.followUp(UUID);
    await next.runTimer();
    expect(next.fetchCalls).toHaveLength(0);
    expect(next.pendingDelays()).toEqual([]);
    expect(next.elements["pw-write-manual"]!.hidden).toBe(false);
    const saved = JSON.parse([...storage.values()][0]!);
    expect(Object.keys(saved).sort()).toEqual(["count", "manualAt", "nextAt", "startedAt", "stopped"]);
    expect(saved.startedAt).toBe(start);
  });

  it("should preserve the original budget when returning from another intent", async () => {
    const h = pageHarness(); h.followUp(UUID);
    h.followUp("22222222-2222-4222-8222-222222222222"); h.setNow(end); h.followUp(UUID);
    h.responders.push(() => statusOf(UUID, "pending")); await h.runTimer();
    expect(h.fetchCalls).toHaveLength(0); expect(h.pendingDelays()).toEqual([]);
  });

  it("should retain manual cooldown after reload and never resume an automatic 429 loop", async () => {
    const storage = new Map<string, string>();
    const first = pageHarness({ storage }); first.followUp(UUID); first.setNow(end); await first.runTimer();
    first.responders.push(() => ({ status: 429, body: {}, retryAfter: "2" })); await manual(first);
    expect(first.fetchCalls).toHaveLength(1);
    const next = pageHarness({ storage, initialNow: end }); next.followUp(UUID);
    next.responders.push(() => statusOf(UUID, "pending")); await manual(next); await next.runTimer();
    expect(next.fetchCalls).toHaveLength(0);
    next.setNow(end + 30_000); await manual(next);
    expect(next.fetchCalls).toHaveLength(1); expect(next.pendingDelays()).toEqual([]);
  });

  it("should retain the in-flight request deadline when reloading", async () => {
    const storage = new Map<string, string>();
    const first = pageHarness({ storage }); first.followUp(UUID);
    let finish!: (result: unknown) => void;
    first.responders.push(() => new Promise((resolve) => { finish = resolve; })); await first.runTimer();
    const next = pageHarness({ storage, initialNow: start + 2000 }); next.followUp(UUID);
    expect(next.pendingDelays()).toEqual([PW_PAGE_POLL_BOUNDS.requestTimeoutMs - 2000]);
    await manual(next); expect(next.fetchCalls).toHaveLength(0);
    finish(statusOf(UUID, "pending")); await first.flush();
  });

  it("should retain the sixty-call cap across reload", async () => {
    const storage = new Map<string, string>();
    const first = pageHarness({ storage }); first.followUp(UUID);
    for (let index = 0; index < 59; index++) {
      first.setNow(start + index); first.responders.push(() => statusOf(UUID, "pending")); await first.runTimer();
    }
    const next = pageHarness({ storage, initialNow: start + 2000 }); next.followUp(UUID);
    for (let index = 0; index < 3; index++) {
      next.responders.push(() => statusOf(UUID, "pending")); await next.runTimer();
    }
    expect(first.fetchCalls.length + next.fetchCalls.length).toBe(60);
    expect(next.pendingDelays()).toEqual([]);
  });

  it("should keep the closed budget after focus", async () => {
    const h = pageHarness(); h.followUp(UUID); h.setNow(end); await h.runTimer();
    h.dispatchVisibility(); h.responders.push(() => statusOf(UUID, "pending")); await h.runTimer();
    expect(h.fetchCalls).toHaveLength(0); expect(h.pendingDelays()).toEqual([]);
  });

  it.each(["unavailable", "corrupt"])("should keep polling closed when budget storage is %s", async (kind) => {
    const storage = new Map<string, string>();
    if (kind === "corrupt") {
      const initial = pageHarness({ storage }); initial.followUp(UUID);
      storage.set([...storage.keys()][0]!, "invalid JSON");
    }
    const h = pageHarness({ storage, storageUnavailable: kind === "unavailable" });
    h.followUp(UUID); h.responders.push(() => statusOf(UUID, "pending")); await h.runTimer(); await manual(h);
    expect(h.fetchCalls).toHaveLength(0); expect(h.pendingDelays()).toEqual([]);
  });
});
