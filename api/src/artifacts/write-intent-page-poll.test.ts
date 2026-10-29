// PW-C PWC-04/06/08: bounded follow-up without opener access — terminal
// states stop polling, Retry-After never resets the window, and the manual
// check stays spaced after the window closes.
import { describe, expect, it } from "vitest";
import {
  PW_PAGE_POLL_BOUNDS,
  PW_PAGE_STATUS_PATH,
} from "./write-intent-page-gesture.js";
import {
  GESTURES,
  pageHarness,
  prepared,
  statusOf,
  UUID,
} from "./write-intent-page-harness.js";

describe("write intent page follow-up", () => {
  it("should follow pending to committed with bounded polls and the hook", async () => {
    const h = pageHarness();
    h.responders.push(() => prepared(UUID));
    h.responders.push(() => statusOf(UUID, "pending"));
    h.responders.push(() => statusOf(UUID, "committed",
      { commandId: UUID, receipt: { event: { id: UUID, createdAt: new Date(1_000_000).toISOString(),
          scope: "personal", facet: "selection", state: "active", basket: "pertinent", reason: null,
          observedFingerprint: "a".repeat(64) } },
        nextAction: "refresh_state" }));
    await h.clickGesture(GESTURES[0]!);
    expect(h.pendingDelays()).toEqual([PW_PAGE_POLL_BOUNDS.intervalMs]);
    await h.runTimer();
    expect(h.fetchCalls[1]!.url).toBe(`${PW_PAGE_STATUS_PATH}?intentId=${UUID}`);
    expect(h.pendingDelays()).toEqual([PW_PAGE_POLL_BOUNDS.intervalMs]);
    await h.runTimer();
    expect(h.elements["pw-write-note"]!.textContent).toContain("Refresh the target");
    expect(h.committed).toHaveLength(1);
    expect(h.pendingDelays()).toEqual([]);
  });

  it("should stop on terminal rejection and expired intents", async () => {
    for (const [state, text] of [["rejected", "Refused"], ["expired", "new gesture"],
      ["revoked", "Revoked"]] as const) {
      const h = pageHarness();
      h.responders.push(() => prepared(UUID));
      h.responders.push(() => statusOf(UUID, state, state === "rejected"
        ? { error: { code: "projection_revision_conflict" } } : {}));
      await h.clickGesture(GESTURES[3]!);
      await h.runTimer();
      expect(h.elements["pw-write-note"]!.textContent).toContain(text);
      expect(h.pendingDelays()).toEqual([]);
    }
  });

  it("should honor retry-after without resetting the poll window", async () => {
    const h = pageHarness();
    h.responders.push(() => prepared(UUID));
    h.responders.push(() => ({ status: 429, body: { error: { code: "write_rate_limited" } },
      retryAfter: "5" }));
    h.responders.push(() => statusOf(UUID, "pending"));
    await h.clickGesture(GESTURES[0]!);
    await h.runTimer();
    expect(h.pendingDelays()).toEqual([5000]);
    h.setNow(1_000_000 + PW_PAGE_POLL_BOUNDS.windowMs);
    await h.runTimer();
    expect(h.fetchCalls.filter((call) => call.url.startsWith(PW_PAGE_STATUS_PATH)))
      .toHaveLength(1);
    expect(h.elements["pw-write-note"]!.textContent).toContain("verify");
    expect(h.pendingDelays()).toEqual([]);
  });

  it("should stop the window after sixty polls and offer one manual check", async () => {
    const h = pageHarness();
    h.responders.push(() => prepared(UUID));
    for (let i = 0; i < PW_PAGE_POLL_BOUNDS.maxPolls; i += 1) {
      h.responders.push(() => statusOf(UUID, "pending"));
    }
    await h.clickGesture(GESTURES[0]!);
    for (let i = 0; i <= PW_PAGE_POLL_BOUNDS.maxPolls; i += 1) await h.runTimer();
    expect(h.fetchCalls.filter((call) => call.url.startsWith(PW_PAGE_STATUS_PATH)))
      .toHaveLength(PW_PAGE_POLL_BOUNDS.maxPolls);
    expect(h.elements["pw-write-manual"]!.hidden).toBe(false);
    expect(h.pendingDelays()).toEqual([]);
  });

  it("should space manual checks and stop on session loss", async () => {
    const h = pageHarness();
    h.responders.push(() => prepared(UUID));
    await h.clickGesture(GESTURES[0]!);
    const manual = h.elements["pw-write-manual"]!;
    h.responders.push(() => statusOf(UUID, "committed",
      { commandId: UUID, receipt: { event: { state: "active", basket: "pertinent" } },
        nextAction: "refresh_state" }));
    for (const fn of manual.listeners.click ?? []) fn({});
    await h.flush();
    expect(h.fetchCalls.filter((call) => call.url.startsWith(PW_PAGE_STATUS_PATH)))
      .toHaveLength(1);
    for (const fn of manual.listeners.click ?? []) fn({});
    await h.flush();
    expect(h.fetchCalls.filter((call) => call.url.startsWith(PW_PAGE_STATUS_PATH)))
      .toHaveLength(1);
    expect(h.elements["pw-write-note"]!.textContent).toContain("Wait before checking");
    h.setNow(1_000_000 + PW_PAGE_POLL_BOUNDS.manualSpacingMs + 1);
    h.responders.push(() => ({ status: 401,
      body: { error: { code: "page_session_expired" } } }));
    for (const fn of manual.listeners.click ?? []) fn({});
    await h.flush();
    expect(h.elements["pw-write-note"]!.textContent).toContain("Sign in again");
    expect(h.pendingDelays()).toEqual([]);
  });

  it("should pause while hidden", async () => {
    const h = pageHarness();
    h.responders.push(() => prepared(UUID));
    await h.clickGesture(GESTURES[0]!);
    h.setHidden(true);
    await h.runTimer();
    expect(h.fetchCalls.filter((call) => call.url.startsWith(PW_PAGE_STATUS_PATH)))
      .toHaveLength(0);
  });
});
