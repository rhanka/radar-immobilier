import { Hono } from "hono";
import { expect, it } from "vitest";
import { writeRefusal } from "./write-intent-refusal.js";
import { writeIntentError } from "./write-intent-errors.js";
import { FacetError } from "../services/facets/target.js";

it("should preserve a strict replay refusal and mask uncertain failures", async () => {
  const app = new Hono();
  app.post("/confirm", (c) => writeRefusal(c, "challenge_consumed", 409));
  app.post("/unknown/confirm", (c) => writeIntentError(c, new Error("private upstream payload")));
  app.post("/version/confirm", (c) => writeIntentError(c, new FacetError(409, "target_version_conflict")));
  const response = await app.request("/confirm", { method: "POST" });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ operation: "facets.write-intents.confirm.v1",
    requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), error: {
      code: "challenge_consumed", message: "Confirmation challenge already consumed.",
      action: "read_status", retryable: false, attemptOutcome: "not_executed" } });
  const unknown = await app.request("/unknown/confirm", { method: "POST" });
  expect(unknown.status).toBe(504);
  expect(await unknown.json()).toMatchObject({ error: { code: "write_outcome_unknown",
    action: "read_status", attemptOutcome: "unknown" } });
  const version = await app.request("/version/confirm", { method: "POST" });
  expect(version.status).toBe(409);
  expect(await version.json()).toMatchObject({ error: { code: "facet_target_version_conflict", action: "refresh_and_confirm" } });
});
