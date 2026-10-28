import { expect, it } from "vitest";
import { Hono } from "hono";
import { validPwPageEnvelope } from "./write-intent-page-envelope.js";
import { projectPageWriteResponse } from "./write-intent-page-response.js";
import { GESTURES, pageHarness, prepared, statusOf, UUID } from "./write-intent-page-harness.js";

const expected = { verb: "status" as const, readerSub: "reader", appOrigin: "https://app.example.test", intentId: UUID };
it.each(["reader", "operation", "intent", "receipt", "private", "state"])("should refuse a %s-invalid status before announcing success", async (change) => {
  const value = statusOf(UUID, "committed").body as unknown as {
    operation: string; reader: { sub: string }; data: Record<string, unknown>;
  };
  expect(validPwPageEnvelope(value, expected)).toBe(true);
  if (change === "reader") value.reader.sub = "another-reader";
  if (change === "operation") value.operation = "facets.write-intents.prepare.v1";
  if (change === "intent") value.data.intentId = "22222222-2222-4222-8222-222222222222";
  if (change === "receipt") delete value.data.receipt;
  if (change === "private") value.data.challengeToken = "private-never-allowed";
  if (change === "state") value.data.state = "successful";
  expect(validPwPageEnvelope(value, expected)).toBe(false);
  const app = new Hono().get("/", (c) => projectPageWriteResponse(c, Response.json(value), expected));
  const response = await app.request("/"); expect(response.status).toBe(502);
  const body = await response.json(); expect(body.error).toMatchObject({ code: "upstream_bad_payload", attemptOutcome: "unknown" });
  expect(JSON.stringify(body)).not.toContain("private-never-allowed");
  const h = pageHarness(); h.responders.push(() => ({ status: 200, body: value })); h.followUp(UUID); await h.runTimer();
  expect(h.committed).toHaveLength(0); expect(h.elements["pw-write-note"]!.textContent).toContain("verify");
});

it.each(["confirmationUrl", "managementUrl", "statusUrl"])("should refuse a foreign %s before opening any app link", async (field) => {
  const value = prepared(UUID).body;
  (value.data as Record<string, unknown>)[field] = "https://foreign.example.test/path";
  const h = pageHarness(); h.responders.push(() => ({ status: 201, body: value }));
  await h.clickGesture(GESTURES[0]!);
  expect(h.opened).toHaveLength(0); expect(h.seenFollowUp).toHaveLength(0);
});

it("should keep the original uncertain body/key through a refused retry", async () => {
  const h = pageHarness(); h.responders.push(() => { throw new Error("response lost"); });
  await h.clickGesture(GESTURES[0]!);
  const first = h.fetchCalls[0]!;
  h.responders.push(() => ({ status: 429, body: { error: { code: "write_rate_limited" } } }));
  for (const fn of h.elements["pw-write-retry"]!.listeners.click ?? []) fn({}); await h.flush();
  await h.clickGesture(GESTURES[1]!); expect(h.fetchCalls).toHaveLength(2);
  h.responders.push(() => prepared(UUID));
  for (const fn of h.elements["pw-write-retry"]!.listeners.click ?? []) fn({}); await h.flush();
  expect(h.fetchCalls).toHaveLength(3);
  expect(h.fetchCalls.every((call) => call.options.body === first.options.body &&
    call.options.headers?.["idempotency-key"] === first.options.headers?.["idempotency-key"])).toBe(true);
  expect(h.readCalls).toHaveLength(1);
});

it("should apply a manual Retry-After of sixty seconds without restarting automatic polling", async () => {
  const h = pageHarness(); h.followUp(UUID); h.setNow(1_120_001); await h.runTimer();
  h.responders.push(() => ({ status: 429, retryAfter: "60", body: { error: { code: "write_rate_limited" } } }));
  for (const fn of h.elements["pw-write-manual"]!.listeners.click ?? []) fn({}); await h.flush();
  expect(h.fetchCalls).toHaveLength(1); h.setNow(1_150_002);
  for (const fn of h.elements["pw-write-manual"]!.listeners.click ?? []) fn({}); await h.flush();
  expect(h.fetchCalls).toHaveLength(1); h.setNow(1_180_002);
  h.responders.push(() => statusOf(UUID, "pending"));
  for (const fn of h.elements["pw-write-manual"]!.listeners.click ?? []) fn({}); await h.flush();
  expect(h.fetchCalls).toHaveLength(2); expect(h.pendingDelays()).toHaveLength(0);
});
