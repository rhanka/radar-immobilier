import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { APP_SUMMARY_SCRIPT } from "./write-intent-app-script.js";
import { FakeElement } from "./write-intent-page-harness.js";

function harness(status = 200, data: unknown = { state: "committed" }) {
  const elements: Record<string, FakeElement> = {};
  for (const id of ["pw-bootstrap", "pw-confirm", "pw-revoke", "pw-note",
    "pw-receipt", "pw-receipt-command", "pw-receipt-state", "pw-receipt-basket",
    "pw-reload-box", "pw-manage-box", "pw-login-box"]) elements[id] = new FakeElement(id);
  elements["pw-bootstrap"]!.textContent = JSON.stringify({ csrf: "private-csrf",
    challengeToken: "private-challenge", confirmUrl: "/intents/one/confirm" });
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const receipts: unknown[] = [];
  runInNewContext(APP_SUMMARY_SCRIPT, {
    document: { getElementById: (id: string) => elements[id] },
    window: { __pwWriteOnCommitted: (receipt: unknown) => receipts.push(receipt) },
    fetch: async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return { status, headers: { get: () => null }, json: async () => data };
    },
  });
  const click = async () => {
    for (const fn of elements["pw-confirm"]!.listeners.click ?? []) fn({});
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  };
  return { elements, requests, receipts, click };
}

describe("controlled application write gestures", () => {
  it("should send nothing until an explicit confirmation click", async () => {
    const h = harness();
    expect(h.requests).toEqual([]);
    await h.click();
    expect(h.requests).toEqual([{ url: "/intents/one/confirm", init: {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-artifact-write-csrf": "private-csrf" },
      body: JSON.stringify({ challengeToken: "private-challenge" }),
    } }]);
    expect(h.receipts).toHaveLength(1);
  });

  it("should require a reload and a new click after CSRF refusal", async () => {
    const h = harness(403, { error: { code: "csrf_refused" } });
    await h.click();
    expect(h.requests).toHaveLength(1);
    expect(h.elements["pw-reload-box"]!.hidden).toBe(false);
    expect(h.elements["pw-note"]!.textContent).toContain("confirm again explicitly");
    expect(h.receipts).toEqual([]);
  });

  it.each([403, 409, 429, 504])("should never project HTTP %s as committed", async (status) => {
    const h = harness(status, { state: "committed", commandId: "untrusted" });
    await h.click();
    expect(h.requests).toHaveLength(1);
    expect(h.receipts).toEqual([]);
    expect(h.elements["pw-receipt"]!.hidden).toBe(true);
  });
});
