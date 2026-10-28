// PW-C PWC-01/03/05: page gestures prepare an intent with an exact body and
// a fresh key, then open the application top-level without opener access.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildPagePrepareBody,
  PW_PAGE_OPERATIONS,
  PW_PAGE_PREPARE_PATH,
} from "./write-intent-page-gesture.js";
import { PW_PAGE_SCRIPT, PW_PAGE_SCRIPT_HASH } from "./write-intent-page.js";
import {
  GESTURES,
  pageHarness,
  prepared,
  UUID,
} from "./write-intent-page-harness.js";

describe("write intent page gestures", () => {
  it("should serve the hashed bytes without opener, postMessage, or popup reads", () => {
    expect(createHash("sha256").update(PW_PAGE_SCRIPT).digest("base64"))
      .toBe(PW_PAGE_SCRIPT_HASH);
    expect(PW_PAGE_SCRIPT).not.toMatch(/\bopener\b|postMessage|popup\.closed/);
    expect(PW_PAGE_OPERATIONS).toHaveLength(6);
  });

  it("should prepare every gesture with an exact body and hand off follow-up", async () => {
    for (const dataset of GESTURES) {
      const h = pageHarness();
      h.hookFollowUp();
      h.responders.push(() => prepared(UUID));
      await h.clickGesture(dataset);
      expect(h.fetchCalls).toHaveLength(1);
      const call = h.fetchCalls[0]!;
      expect(call.url).toBe(PW_PAGE_PREPARE_PATH);
      expect(call.options.method).toBe("POST");
      expect(call.options.headers).toMatchObject({ "content-type": "application/json" });
      expect(call.options.headers!["idempotency-key"])
        .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      const { pwOperation, pwWorkspace, pwCity, pwType, pwId, pwBasket, pwReason,
        pwDeselect, pwExpectedHead, pwExpectedHeads, pwFingerprint, pwToken } = dataset;
      expect(JSON.parse(call.options.body!)).toEqual(buildPagePrepareBody({
        operation: pwOperation, workspaceId: pwWorkspace,
        target: { citySlug: pwCity, type: pwType, id: pwId },
        ...(pwBasket === undefined ? {} : { basket: pwBasket }),
        ...(pwReason === undefined ? {} : { reasonCode: pwReason }),
        ...(pwDeselect === undefined ? {} : { deselect: pwDeselect.split(",") }),
        ...(pwExpectedHead === undefined ? {} : { expectedHeadId: pwExpectedHead || null }),
        ...(pwExpectedHeads === undefined ? {}
          : { expectedSelectionHeads: JSON.parse(pwExpectedHeads) }),
        displayedFingerprint: pwFingerprint, expectedProjectionToken: pwToken }));
      expect(h.opened).toEqual([{ url: expect.stringContaining("/artifact-write/intents/"),
        target: "_blank", features: "noopener,noreferrer" }]);
      expect(h.seenFollowUp).toEqual([UUID]);
      expect(h.pendingDelays()).toEqual([]);
    }
  });

  it("should refuse an incomplete gesture without touching the network", async () => {
    const h = pageHarness();
    await h.clickGesture({ ...GESTURES[0]!, pwFingerprint: "short" });
    expect(h.fetchCalls).toHaveLength(0);
    expect(h.elements["pw-write-note"]!.textContent).toContain("incomplete");
  });

  it("should replay the exact key after a lost prepare response", async () => {
    const h = pageHarness();
    h.hookFollowUp();
    let calls = 0;
    h.responders.push(() => {
      calls += 1;
      throw new Error("socket reset");
    });
    h.responders.push(() => prepared(UUID));
    await h.clickGesture(GESTURES[0]!);
    expect(calls).toBe(1);
    expect(h.elements["pw-write-retry"]!.hidden).toBe(false);
    for (const fn of h.elements["pw-write-retry"]!.listeners.click ?? []) fn({});
    await h.flush();
    expect(h.fetchCalls).toHaveLength(2);
    expect(h.fetchCalls[0]!.options.headers!["idempotency-key"])
      .toBe(h.fetchCalls[1]!.options.headers!["idempotency-key"]);
    expect(JSON.parse(h.fetchCalls[0]!.options.body!))
      .toEqual(JSON.parse(h.fetchCalls[1]!.options.body!));
    expect(h.seenFollowUp).toEqual([UUID]);
  });

  it("should never forge listener proof headers", async () => {
    const h = pageHarness();
    h.hookFollowUp();
    h.responders.push(() => prepared(UUID));
    await h.clickGesture(GESTURES[0]!);
    expect(h.fetchCalls[0]!.options.headers).not.toHaveProperty("x-preview-grant");
    expect(h.fetchCalls[0]!.options.headers).not.toHaveProperty("x-preview-session");
  });
});
