import { expect, it } from "vitest";
import { GESTURES, pageHarness, prepared, statusOf, UUID } from "./write-intent-page-harness.js";

function current(token: string, fingerprint: string, head: string | null) {
  return { status: 200, body: { ok: true, workspaceId: UUID, snapshot: { baseToken: token }, item: {
    target: { citySlug: "demo-town", type: "Signal", id: "sig-1" }, displayedFingerprint: fingerprint,
    facets: { selection: { pertinent: head ? { id: head, state: "active" } : null, a_surveiller: null },
      archive: { personal: null, workspace: null } },
  } } };
}

it("should read current heads, fingerprint and 6L1 before two successive gestures", async () => {
  const h = pageHarness(); h.hookFollowUp();
  h.readResponders.push(() => current("b".repeat(64), "c".repeat(64), null));
  h.responders.push(() => prepared(UUID)); await h.clickGesture(GESTURES[0]!);
  expect(h.readCalls).toHaveLength(1);
  expect(h.readCalls[0]!.url).toContain("baskets.state.v1?");
  expect(h.readCalls[0]!.url).toContain("id=sig-1");
  expect(JSON.parse(h.fetchCalls[0]!.options.body!)).toMatchObject({ expectedHeadId: null,
    expectedProjectionToken: "b".repeat(64), displayedFingerprint: "c".repeat(64) });
  h.readResponders.push(() => current("d".repeat(64), "e".repeat(64), UUID));
  h.responders.push(() => prepared("22222222-2222-4222-8222-222222222222"));
  await h.clickGesture(GESTURES[0]!);
  expect(h.readCalls).toHaveLength(2);
  expect(JSON.parse(h.fetchCalls[1]!.options.body!)).toMatchObject({ expectedHeadId: UUID,
    expectedProjectionToken: "d".repeat(64), displayedFingerprint: "e".repeat(64) });
  expect(h.fetchCalls[1]!.options.headers!["idempotency-key"]).not.toBe(h.fetchCalls[0]!.options.headers!["idempotency-key"]);
});

it("should keep the receipt when post-commit refresh fails", async () => {
  const h = pageHarness(); h.responders.push(() => prepared(UUID)); await h.clickGesture(GESTURES[0]!);
  const committed = statusOf(UUID, "committed");
  h.responders.push(() => committed); h.readResponders.push(() => { throw new Error("Read unavailable"); });
  await h.runTimer();
  expect(h.elements["pw-page-receipt"]!.textContent).not.toBe("");
  expect(JSON.parse(h.elements["pw-page-receipt"]!.textContent)).toEqual(committed.body.data);
  expect(h.elements["pw-write-note"]!.textContent).toContain("recorded; display needs refresh");
  expect(h.pendingDelays()).toEqual([]);
});

it("should not dispatch prepare or reserve an uncertain key when the targeted read failed", async () => {
  const h = pageHarness(); h.readResponders.push(() => ({ status: 403, body: { error: "revoked" } }));
  await h.clickGesture(GESTURES[0]!); expect(h.fetchCalls).toHaveLength(0);
  h.responders.push(() => prepared(UUID)); await h.clickGesture(GESTURES[0]!);
  expect(h.readCalls).toHaveLength(2); expect(h.fetchCalls).toHaveLength(1);
});
it("should explicitly reveal the targeted archive for restore and its post-commit refresh", async () => {
  const h = pageHarness(); h.responders.push(() => prepared(UUID)); await h.clickGesture(GESTURES[3]!);
  expect(new URL(h.readCalls[0]!.url, "https://page.test").searchParams.get("reveal")).toBe("true");
  h.responders.push(() => statusOf(UUID, "committed")); await h.runTimer();
  expect(new URL(h.readCalls[1]!.url, "https://page.test").searchParams.get("reveal")).toBe("true");
});
