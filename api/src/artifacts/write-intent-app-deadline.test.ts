import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { APP_SUMMARY_SCRIPT } from "./write-intent-app-script.js";
import { FakeElement } from "./write-intent-page-harness.js";

it.each(["confirm transport", "confirm body", "revoke transport", "revoke body"])(
  "should release controls and expose same-intent recovery after suspended %s", async (scenario) => {
    const nodes: Record<string, FakeElement> = {};
    for (const id of ["pw-bootstrap", "pw-confirm", "pw-revoke", "pw-note", "pw-manage-box", "pw-receipt"]) {
      nodes[id] = new FakeElement(id);
    }
    nodes["pw-bootstrap"]!.textContent = JSON.stringify({ csrf: "csrf", challengeToken: "challenge",
      confirmUrl: "/intents/I/confirm", revokeUrl: "/intents/I/revoke" });
    let release = (_value: unknown) => {};
    const held = new Promise((resolve) => { release = resolve; });
    const timers: Array<{ fn: () => void; delay: number }> = [];
    const requests: string[] = [];
    runInNewContext(APP_SUMMARY_SCRIPT, {
      document: { getElementById: (id: string) => nodes[id] }, window: {},
      setTimeout: (fn: () => void, delay: number) => { timers.push({ fn, delay }); return timers.length; },
      clearTimeout: () => {}, AbortController,
      fetch: async (url: string) => {
        requests.push(url);
        if (scenario.endsWith("transport")) await held;
        return { status: 200, headers: new Headers(), json: async () => {
          if (scenario.endsWith("body")) await held;
          return { state: "committed", receipt: { event: null }, authorizationState: "revoked" };
        } };
      },
    });
    const button = nodes[scenario.startsWith("confirm") ? "pw-confirm" : "pw-revoke"]!;
    button.listeners.click![0]!({});
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(button.disabled).toBe(true);
    expect(timers.map((timer) => timer.delay)).toContain(15000);
    timers.find((timer) => timer.delay === 15000)!.fn();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(button.disabled).toBe(false);
    expect(nodes["pw-note"]!.textContent).toContain("Result to verify");
    expect(nodes["pw-manage-box"]!.hidden).toBe(false);
    const note = nodes["pw-note"]!.textContent;
    release(null);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(nodes["pw-note"]!.textContent).toBe(note);
    expect(nodes["pw-receipt"]!.hidden).toBe(true);
    expect(requests).toEqual([scenario.startsWith("confirm") ? "/intents/I/confirm" : "/intents/I/revoke"]);
  },
);
