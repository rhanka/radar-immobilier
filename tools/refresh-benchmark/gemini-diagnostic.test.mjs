import assert from "node:assert/strict";
import test from "node:test";

import {
  CLOUD_CODE_ENDPOINTS,
  buildProbeRequest,
  resolveCloudCodeEndpoint,
  sanitizeCloudCodeError,
} from "./gemini-diagnostic.mjs";

test("Cloud Code error evidence retains only a redacted whitelist", () => {
  const error = sanitizeCloudCodeError({ error: {
    code: 404,
    status: "NOT_FOUND",
    message: "project secret-prod-123 for user owner@example.com was not found; Bearer abc.def.ghi",
    details: [{ token: "must-not-survive" }],
  } });
  assert.deepEqual(Object.keys(error), ["code", "status", "message"]);
  assert.equal(error.code, 404);
  assert.equal(error.status, "NOT_FOUND");
  assert.equal(error.message,
    "project [redacted-project] for user [redacted-email] was not found; Bearer [redacted]");
  assert.doesNotMatch(JSON.stringify(error), /secret-prod|example\.com|must-not-survive|abc\.def/);
});

test("probe matrix preserves model and effort while changing only endpoint", () => {
  const daily = buildProbeRequest({ model: "gemini-3.8-flash", effort: "low" });
  const stable = buildProbeRequest({ model: "gemini-3.8-flash", effort: "low" });
  assert.deepEqual(daily, stable);
  assert.equal(CLOUD_CODE_ENDPOINTS.mesh,
    "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse");
  assert.equal(CLOUD_CODE_ENDPOINTS.agy,
    "https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse");
  assert.deepEqual(daily.reasoning, { effort: "low" });
  assert.equal(daily.maxOutputTokens, 64);
});

test("omitted effort is genuinely absent", () => {
  assert.equal("reasoning" in buildProbeRequest({ model: "gemini-3.8-flash" }), false);
});

test("integration preflight consumes the endpoint supplied by the installed package", () => {
  const supplied = "https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";
  assert.equal(resolveCloudCodeEndpoint("package", supplied), supplied);
  assert.equal(resolveCloudCodeEndpoint("mesh", supplied), CLOUD_CODE_ENDPOINTS.mesh);
  assert.throws(() => resolveCloudCodeEndpoint("unknown", supplied), /package, mesh, or agy/);
});
