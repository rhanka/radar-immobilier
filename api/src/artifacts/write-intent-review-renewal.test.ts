import { expect, it } from "vitest";
import { GESTURES, pageHarness, prepared, statusOf, UUID } from "./write-intent-page-harness.js";

it("should recover an expired read grant before a gesture after 55 seconds", async () => {
  const h = pageHarness(); h.hookFollowUp(); h.setNow(1_060_000);
  h.renewResponders.push(() => ({ status: 401 }), () => ({ status: 200, body: { grant: "recovered" } }));
  h.responders.push(() => prepared(UUID));
  await h.clickGesture(GESTURES[0]!);
  expect(h.renewCalls).toHaveLength(2);
  expect(h.renewCalls[0]!.options.headers).toEqual({ "x-preview-grant": "synthetic-read" });
  expect(h.renewCalls[1]!.options.headers).toEqual({});
  expect(h.readCalls[0]!.options.headers).toEqual({ "x-preview-grant": "recovered" });
  expect(h.fetchCalls).toHaveLength(1);
});

it("should refresh state and cards with recovered authority after confirmation beyond 55 seconds", async () => {
  const h = pageHarness(); h.responders.push(() => prepared(UUID));
  await h.clickGesture(GESTURES[0]!);
  h.setNow(1_060_000);
  h.renewResponders.push(() => ({ status: 401 }), () => ({ status: 200, body: { grant: "recovered" } }));
  h.responders.push(() => statusOf(UUID, "committed"));
  await h.runTimer(2000);
  expect(h.elements["pw-page-receipt"]!.textContent).toContain('"committed"');
  expect(h.elements["pw-live-counts"]!.textContent).toBe('{"matched":0}');
  expect(h.readCalls[1]!.options.headers).toEqual({ "x-preview-grant": "recovered" });
  expect(h.readCalls[2]!.options.headers).toEqual({ "x-preview-grant": "fresh-read" });
  expect(h.fetchCalls.filter((call) => call.options.method === "POST")).toHaveLength(1);
});

it("should refuse recovery after rights loss without preparing or replacing the old receipt", async () => {
  const h = pageHarness();
  h.renewResponders.push(() => ({ status: 401 }), () => ({ status: 401 }));
  await h.clickGesture(GESTURES[0]!);
  expect(h.fetchCalls).toEqual([]);
  expect(h.readCalls).toEqual([]);
});
