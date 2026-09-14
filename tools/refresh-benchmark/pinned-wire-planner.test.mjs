import assert from "node:assert/strict";
import test from "node:test";

import { createPinnedWirePlanner } from "./pinned-wire-planner.mjs";

test("pinned planner acquires the wire model and records validation failure", async () => {
  const calls = []; const outcomes = [];
  const runtime = { async generate(request) { calls.push(["generate", request]); return {}; } };
  const facade = {
    async acquire(input) { calls.push(["acquire", input]); return { material: { token: "opaque" } }; },
    async release(input) { calls.push(["release", input]); },
  };
  const variant = { provider: "gemini", transport: "cloud-code",
    model: "gemini-3.8-flash-tiered" };
  const planner = createPinnedWirePlanner({ runtime, facade, account: { accountId: "account" },
    variant, routingSubject: { ownerScopeRef: "owner" }, affinityKey: "pdf", outcomes });
  const plan = await planner.plan();
  assert.deepEqual(plan.candidateRefs, ["cloud-code:pinned-wire"]);
  const attempt = await planner.prepareAttempt(null, null, null, "request");
  await attempt.generate({ modelId: variant.model });
  await attempt.recordOutcome({ reason: "invalid-request", retryable: true });
  assert.equal(calls[0][1].modelId, variant.model);
  assert.deepEqual(calls[1][1].auth, { token: "opaque" });
  assert.equal(calls.filter(([name]) => name === "release").length, 1);
  assert.deepEqual(outcomes, [{ status: "failed",
    outcome: { reason: "invalid-request", retryable: true }, usage: null }]);
});
