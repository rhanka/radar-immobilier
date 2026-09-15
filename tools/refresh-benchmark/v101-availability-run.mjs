import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { pingAnthropic, pingMistral, pingOpenAi } from "./v101-direct-ping.mjs";
import { pingMesh } from "./v101-mesh-ping.mjs";
import { claimOnce, completeClaim, prompt, writeOnce } from "./v101-probe-lib.mjs";
import { arms } from "./v101-arms.mjs";

const armName = process.argv[2];
const arm = arms[armName];
if (!arm) throw new Error(`Unknown v101 arm: ${armName ?? "N-A"}`);
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
    error: { category: "local-preflight", code: error instanceof Error
      && error.message.endsWith("is absent") ? "credential-absent" : "probe-failed" } };
}
if (actual.requestCount > 3) throw new Error("Phase-1 request ceiling exceeded");
const receipt = { schemaVersion: 1, capturedAt: new Date().toISOString(), arm: armName,
  requested: { transport: arm.transport, modelId: arm.model,
    effort: armName.endsWith("-off") ? "off" : arm.effort,
    maxOutputTokens: 64, prompt }, actual, llmMeshVersion: packageVersion,
  requestCount: actual.requestCount ?? actual.wire?.length ?? 0,
  redaction: { allowlistedFieldsOnly: true, secretsIncluded: false } };
await writeOnce(receiptPath, receipt);
await completeClaim(lockPath, receiptPath);
console.log(JSON.stringify({ arm: armName, httpStatus: actual.httpStatus,
  resolvedModelId: actual.resolvedModelId, wireModelId: actual.wireModelId ?? null,
  pingExact: actual.pingExact, latencyMs: actual.latencyMs, requestCount: receipt.requestCount }));
if (actual.httpStatus !== 200 || !actual.pingExact) process.exitCode = 1;
