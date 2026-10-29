import { describe, expect, it } from "vitest";
import { GESTURES, pageHarness, prepared, statusOf, UUID } from "./write-intent-page-harness.js";
import { PW_PAGE_POLL_BOUNDS, PW_PAGE_STATUS_PATH } from "./write-intent-page-gesture.js";
import { PW_PAGE_SCRIPT } from "./write-intent-page.js";

describe("page write invariant regressions", () => {
  it("should expose neither app credentials nor a confirmation endpoint", () => {
    expect(PW_PAGE_SCRIPT).not.toMatch(/challengeToken|x-artifact-write-csrf|radar_session|\/confirm/);
  });

  it("should keep the fixed budget when follow-up starts again for the same intent", async () => {
    const h = pageHarness();
    h.responders.push(() => prepared(UUID));
    await h.clickGesture(GESTURES[0]!);
    h.setNow(1_000_000 + PW_PAGE_POLL_BOUNDS.windowMs);
    h.followUp(UUID);
    await h.runTimer();
    expect(h.fetchCalls.filter((call) => call.url.startsWith(PW_PAGE_STATUS_PATH))).toHaveLength(0);
    expect(h.pendingDelays()).toEqual([]);
    expect(h.elements["pw-write-note"]!.textContent).toContain("verify");
  });

  it("should never resume automatic polling after a manual rate limit", async () => {
    const h = pageHarness();
    h.responders.push(() => prepared(UUID));
    await h.clickGesture(GESTURES[0]!);
    h.setNow(1_000_000 + PW_PAGE_POLL_BOUNDS.windowMs);
    await h.runTimer();
    h.responders.push(() => ({ status: 429, body: {}, retryAfter: "5" }));
    for (const fn of h.elements["pw-write-manual"]!.listeners.click ?? []) fn({});
    await h.flush();
    h.responders.push(() => statusOf(UUID, "pending"));
    await h.runTimer();
    expect(h.fetchCalls.filter((call) => call.url.startsWith(PW_PAGE_STATUS_PATH))).toHaveLength(1);
    expect(h.pendingDelays()).toEqual([]);
  });

  it("should allow only one in-flight status request including manual checks", async () => {
    const h = pageHarness();
    let resolve!: (value: unknown) => void;
    h.responders.push(() => prepared(UUID));
    h.responders.push(() => new Promise((done) => { resolve = done; }));
    await h.clickGesture(GESTURES[0]!);
    await h.runTimer();
    for (const fn of h.elements["pw-write-manual"]!.listeners.click ?? []) fn({});
    await h.flush();
    expect(h.fetchCalls.filter((call) => call.url.startsWith(PW_PAGE_STATUS_PATH))).toHaveLength(1);
    resolve(statusOf(UUID, "pending"));
    await h.flush();
  });

  it("should ignore a late result from a previous intent", async () => {
    const h = pageHarness();
    let resolve!: (value: unknown) => void;
    h.responders.push(() => prepared(UUID));
    h.responders.push(() => new Promise((done) => { resolve = done; }));
    await h.clickGesture(GESTURES[0]!);
    await h.runTimer();
    h.followUp("22222222-2222-4222-8222-222222222222");
    resolve(statusOf(UUID, "committed"));
    await h.flush();
    expect(h.committed).toEqual([]);
    expect(h.pendingDelays()).toEqual([PW_PAGE_POLL_BOUNDS.intervalMs]);
  });

  it("should keep uncertain preparation on the same key until explicitly retried", async () => {
    const h = pageHarness();
    h.responders.push(() => { throw new Error("response lost"); });
    await h.clickGesture(GESTURES[0]!);
    await h.clickGesture(GESTURES[0]!);
    expect(h.fetchCalls).toHaveLength(1);
  });

  it("should keep the minimum poll interval on a short Retry-After", async () => {
    const h = pageHarness();
    h.responders.push(() => prepared(UUID));
    h.responders.push(() => ({ status: 429, body: {}, retryAfter: "1" }));
    await h.clickGesture(GESTURES[0]!);
    await h.runTimer();
    expect(h.pendingDelays()).toEqual([PW_PAGE_POLL_BOUNDS.intervalMs]);
  });

  it.each([201, 504])("should keep the same prepare key after an uncertain HTTP %s response", async (status) => {
    const h = pageHarness();
    h.responders.push(() => ({ status, body: null }));
    await h.clickGesture(GESTURES[0]!);
    expect(h.elements["pw-write-retry"]!.hidden).toBe(false);
    await h.clickGesture(GESTURES[0]!);
    expect(h.fetchCalls).toHaveLength(1);
    h.responders.push(() => prepared(UUID));
    for (const fn of h.elements["pw-write-retry"]!.listeners.click ?? []) fn({});
    await h.flush();
    expect(h.fetchCalls).toHaveLength(2);
    expect(h.fetchCalls[1]!.options).toEqual(h.fetchCalls[0]!.options);
  });

  it.each([403, 409, 429, 504])("should never accept HTTP %s as a committed status", async (status) => {
    const h = pageHarness();
    h.responders.push(() => prepared(UUID));
    h.responders.push(() => ({ ...statusOf(UUID, "committed"), status }));
    await h.clickGesture(GESTURES[0]!);
    await h.runTimer();
    expect(h.committed).toEqual([]);
    expect(h.fetchCalls.every((call) => !call.url.includes("/confirm"))).toBe(true);
  });
});
