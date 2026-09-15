import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { pingAnthropic, pingMistral, pingOpenAi } from "./v101-direct-ping.mjs";
import { pingMesh } from "./v101-mesh-ping.mjs";
import { claimOnce, completeClaim, prompt, writeOnce } from "./v101-probe-lib.mjs";

const codexEfforts = ["low", "medium", "high", "xhigh"];
const arms = Object.fromEntries([
  ...["low", "medium", "high"].map((effort) =>
    [`gemini-${effort}`, { transport: "cloud-code", model: "gemini-3.8-flash", effort }]),
  ...codexEfforts.map((effort) =>
    [`luna-${effort}`, { transport: "codex", model: "gpt-5.6-luna", effort }]),
  ...codexEfforts.map((effort) =>
    [`codex53-${effort}`, { transport: "codex", model: process.env.BENCHMARK_CODEX53_MODEL, effort }]),
  ["gpt41", { transport: "openai-api", model: "gpt-4.1", effort: null }],
  ...["off", "low", "high"].map((effort) =>
    [`sonnet46-cloud-${effort}`, { transport: "cloud-code", model: "claude-sonnet-4-6",
      effort: effort === "off" ? null : effort }]),
  ...["off", "low", "high"].map((effort) =>
    [`sonnet5-${effort}`, { transport: "anthropic-api", model: "claude-sonnet-5", effort }]),
  ...["off", "low", "high"].map((effort) =>
    [`opus5-${effort}`, { transport: "anthropic-api", model: "claude-opus-5", effort }]),
  ...codexEfforts.map((effort) =>
    [`sol-${effort}`, { transport: "codex", model: "gpt-5.6-sol", effort }]),
  ...codexEfforts.map((effort) =>
    [`astra-${effort}`, { transport: "codex", model: "gpt-6-astra", effort }]),
  ["mistral-small4", { transport: "mistral-api", model: "mistral-small-2603", effort: null }],
]);

const armName = process.argv[2];
const arm = arms[armName];
if (!arm) throw new Error(`Unknown v101 arm: ${armName ?? "N-A"}`);
if (!arm.model) throw new Error("The live Codex 5.3 model id has not been resolved");

const resultRoot = process.env.BENCHMARK_RESULT_ROOT;
if (!resultRoot) throw new Error("BENCHMARK_RESULT_ROOT is required");
const receiptPath = resolve(resultRoot, "availability", `ping-${armName}.json`);
const lockPath = resolve(resultRoot, "availability", `ping-${armName}.lock.json`);
if (!await claimOnce(lockPath, receiptPath)) process.exit(0);

const meshTransport = ["codex", "cloud-code"].includes(arm.transport);
const packageVersion = meshTransport ? JSON.parse(await readFile(
  "/workspace/node_modules/@sentropic/llm-mesh/package.json", "utf8")).version : null;
if (meshTransport && packageVersion !== "0.19.2") {
  throw new Error(`llm-mesh 0.19.2 required, got ${packageVersion}`);
}

let actual;
try {
  if (arm.transport === "openai-api") actual = await pingOpenAi(arm.model);
  else if (arm.transport === "anthropic-api") actual = await pingAnthropic(arm.model, arm.effort);
  else if (arm.transport === "mistral-api") actual = await pingMistral(arm.model);
  else actual = await pingMesh(arm);
} catch (error) {
  actual = { httpStatus: null, latencyMs: null, resolvedModelId: null, wireModelId: null,
    finishReason: null, output: "", pingExact: false, usage: null,
    requestCount: Number.isInteger(error?.requestCount) ? error.requestCount : 0,
    error: { category: "local-preflight",
      code: error instanceof Error && error.message.endsWith("is absent")
        ? "credential-absent" : "probe-failed" } };
}
if (actual.requestCount > 3) throw new Error("Phase-1 request ceiling exceeded");
const receipt = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  arm: armName,
  requested: { transport: arm.transport, modelId: arm.model,
    effort: armName.endsWith("-off") ? "off" : arm.effort,
    maxOutputTokens: 64, prompt },
  actual,
  llmMeshVersion: packageVersion,
  requestCount: actual.requestCount ?? actual.wire?.length ?? 0,
  redaction: { allowlistedFieldsOnly: true, secretsIncluded: false },
};
await writeOnce(receiptPath, receipt);
await completeClaim(lockPath, receiptPath);
console.log(JSON.stringify({ arm: armName, httpStatus: actual.httpStatus,
  resolvedModelId: actual.resolvedModelId, wireModelId: actual.wireModelId ?? null,
  pingExact: actual.pingExact, latencyMs: actual.latencyMs, requestCount: receipt.requestCount }));
if (actual.httpStatus !== 200 || !actual.pingExact) process.exitCode = 1;
