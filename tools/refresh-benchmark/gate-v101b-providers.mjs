import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { pingAnthropic } from "./v101-direct-ping.mjs";
import { probeMesh } from "./v101-mesh-ping.mjs";
import { providerGatePassed } from "./v101-runner-state.mjs";

const root = process.env.BENCHMARK_RESULT_ROOT
  || (() => { throw new Error("BENCHMARK_RESULT_ROOT is required"); })();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const providers = [
  ["cloud", () => probeMesh({ transport: "cloud-code", model: "gemini-3.8-flash",
    effort: "low", maxOutputTokens: 64, requestLimit: 1 })],
  ["codex", () => probeMesh({ transport: "codex", model: "gpt-5.6-sol",
    effort: "low", maxOutputTokens: 64, requestLimit: 1 })],
  ["anthropic", () => pingAnthropic("claude-sonnet-5", "low")],
];

function safeOutcome(index, value) {
  const errorCode = value.error?.code ?? (value.error?.status ? `HTTP_${value.error.status}` : null);
  return { index, requestCount: value.requestCount ?? value.wire?.length ?? 0,
    httpStatus: value.httpStatus ?? null, accepted: value.httpStatus === 200 && value.pingExact,
    refusal: value.httpStatus === 200 ? null : errorCode ?? `HTTP_${value.httpStatus ?? "N-A"}`,
    noActiveAccount: errorCode === "no_active_account",
    finishReason: value.finishReason ?? null, outputSha256: value.output
      ? sha256(value.output) : null };
}

let failed = false;
for (const [provider, request] of providers) {
  const outcomes = [];
  for (let index = 1; index <= 3; index += 1) {
    try { outcomes.push(safeOutcome(index, await request())); }
    catch (error) {
      outcomes.push(safeOutcome(index, { requestCount: error?.requestCount ?? 0,
        httpStatus: null, error: { code: error?.code ?? error?.name ?? "probe_failed" } }));
    }
  }
  const passed = providerGatePassed(outcomes, 3);
  failed ||= !passed;
  const receipt = { schemaVersion: 1, campaign: "v101b", capturedAt: new Date().toISOString(),
    provider, llmMeshVersion: provider === "anthropic" ? null : "0.19.3",
    requiredRequests: 3, outcomes, passed,
    redaction: { allowlistedFieldsOnly: true, secretsIncluded: false } };
  await writeFile(resolve(root, "gates", `provider-${provider}.json`),
    `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ provider, requests: outcomes.reduce((sum, item) =>
    sum + item.requestCount, 0), passed }));
}
await writeFile(resolve(root, "gates", "provider-mistral.json"), `${JSON.stringify({
  schemaVersion: 1, campaign: "v101b", capturedAt: new Date().toISOString(),
  provider: "mistral", status: "not-applicable", sourceCampaign: "v101",
  reason: "mistral-small4 is reused byte-for-byte", passed: true,
  redaction: { allowlistedFieldsOnly: true, secretsIncluded: false },
}, null, 2)}\n`, { flag: "wx" });
if (failed) process.exitCode = 1;
