import { expect, it } from "vitest";
import { GESTURES, pageHarness, prepared, statusOf, UUID } from "./write-intent-page-harness.js";
import { PW_PAGE_POLL_BOUNDS } from "./write-intent-page-gesture.js";

const J = "22222222-2222-4222-8222-222222222222";
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function state(token = "a".repeat(64)) {
  return { status: 200, body: { ok: true, workspaceId: UUID, snapshot: { baseToken: token }, item: {
    target: { citySlug: "demo-town", type: "Signal", id: "sig-1" }, displayedFingerprint: token,
    facets: { selection: { pertinent: null, a_surveiller: null }, archive: { personal: null, workspace: null } },
  } } };
}
const search = () => ({ status: 200, body: { ok: true, workspaceId: UUID,
  snapshot: { baseToken: "a".repeat(64) }, items: [{ old: "I" }], counts: { matched: 1 } } });

it.each(["state", "search", "failure"])(
  "should preserve J's display and in-flight follow-up when I's suspended %s finishes", async (phase) => {
    const storage = new Map<string, string>();
    const h = pageHarness({ storage });
    h.responders.push(() => prepared(UUID)); await h.clickGesture(GESTURES[0]!);
    const old = deferred<unknown>();
    if (phase === "search") h.readResponders.push(() => state());
    h.readResponders.push(() => old.promise);
    h.responders.push(() => statusOf(UUID, "committed")); await h.runTimer();
    expect(h.elements["pw-page-receipt"]!.textContent).toContain(UUID);

    h.readResponders.push(() => state("b".repeat(64)));
    h.responders.push(() => prepared(J)); await h.clickGesture(GESTURES[0]!);
    const pendingJ = deferred<unknown>();
    h.responders.push(() => pendingJ.promise); await h.runTimer(PW_PAGE_POLL_BOUNDS.intervalMs);
    expect(h.fetchCalls.filter((c) => c.url.includes(`intentId=${J}`))).toHaveLength(1);
    const visible = ["pw-live-state", "pw-live-cards", "pw-live-counts", "pw-write-note"]
      .map((id) => h.elements[id]!.textContent);
    if (phase === "failure") old.reject(new Error("Old refresh failed"));
    else {
      h.readResponders.push(search);
      old.resolve(phase === "search" ? search() : state());
    }
    await h.flush();
    expect(["pw-live-state", "pw-live-cards", "pw-live-counts", "pw-write-note"]
      .map((id) => h.elements[id]!.textContent)).toEqual(visible);
    const budget = (id: string) => JSON.parse(storage.get(`radar:pw:budget:v1:${id}`)!);
    expect(budget(UUID).stopped).toBe(true);
    expect(budget(J).stopped).toBe(false);
    for (const click of h.elements["pw-write-manual"]!.listeners.click ?? []) click({});
    await h.flush();
    expect(h.fetchCalls.filter((c) => c.url.includes(`intentId=${J}`))).toHaveLength(1);
    pendingJ.resolve(statusOf(J, "pending")); await h.flush();
    expect(h.pendingDelays()).toEqual([PW_PAGE_POLL_BOUNDS.intervalMs]);
  });

it.each(["fetch", "body"])("should release preparation after a suspended targeted read %s times out", async (phase) => {
  const h = pageHarness(); h.hookFollowUp();
  const stalled = new Promise(() => {});
  h.readResponders.push(() => phase === "fetch" ? stalled : { status: 200, body: stalled });
  await h.clickGesture(GESTURES[0]!);
  expect(h.fetchCalls).toHaveLength(0);
  expect(h.pendingDelays()).toContain(15_000);
  await h.runTimer();
  expect(h.elements["pw-write-note"]!.textContent).toContain("Target refresh failed");
  expect(h.pendingDelays()).toEqual([]);
  h.responders.push(() => prepared(J)); await h.clickGesture(GESTURES[0]!);
  expect(h.fetchCalls).toHaveLength(1);
  expect(h.elements["pw-write-note"]!.textContent).not.toContain("failed");
});

it.each(["fetch", "body"])("should retain the receipt and release controls after a suspended post-commit %s times out", async (phase) => {
  const storage = new Map<string, string>();
  const h = pageHarness({ storage });
  h.responders.push(() => prepared(UUID)); await h.clickGesture(GESTURES[0]!);
  const stalled = new Promise(() => {});
  h.readResponders.push(() => phase === "fetch" ? stalled : { status: 200, body: stalled });
  h.responders.push(() => statusOf(UUID, "committed")); await h.runTimer();
  const receipt = h.elements["pw-page-receipt"]!.textContent;
  expect(receipt).toContain(UUID);
  expect(JSON.parse(storage.get(`radar:pw:budget:v1:${UUID}`)!).stopped).toBe(true);
  await h.runTimer();
  expect(h.elements["pw-page-receipt"]!.textContent).toBe(receipt);
  expect(h.elements["pw-write-note"]!.textContent).toContain("recorded; display needs refresh");
  expect(h.pendingDelays()).toEqual([]);
  h.responders.push(() => prepared(J)); await h.clickGesture(GESTURES[0]!);
  h.responders.push(() => statusOf(J, "pending")); await h.runTimer();
  expect(h.fetchCalls.filter((c) => c.url.includes(`intentId=${J}`))).toHaveLength(1);
  expect(h.pendingDelays()).toEqual([PW_PAGE_POLL_BOUNDS.intervalMs]);
});
