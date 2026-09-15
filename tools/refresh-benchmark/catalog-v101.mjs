import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { listModelProfiles } from "/workspace/node_modules/@sentropic/llm-mesh/dist/index.js";
import { createLlmMeshFacade } from
  "/workspace/node_modules/@sentropic/llm-mesh/dist/service/facade.js";
import { EncryptedFileKeyring } from
  "/workspace/node_modules/@sentropic/llm-mesh/dist/node/index.js";
import { fetchAvailableModels } from
  "/workspace/node_modules/@sentropic/llm-mesh/dist/enrollment/cloud-code.js";

import { claimOnce, completeClaim, endpointPath, sha256, writeOnce } from "./v101-probe-lib.mjs";

async function getJson(url, headers = {}) {
  const started = Date.now();
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
  const payload = await response.json().catch(() => null);
  return { httpStatus: response.status, durationMs: Date.now() - started, payload };
}

function collectIds(value, pattern, output = new Set()) {
  if (typeof value === "string" && pattern.test(value)) output.add(value);
  else if (Array.isArray(value)) value.forEach((entry) => collectIds(entry, pattern, output));
  else if (value && typeof value === "object") {
    Object.values(value).forEach((entry) => collectIds(entry, pattern, output));
  }
  return [...output].sort();
}

function modelDescriptors(value, pattern, output = []) {
  if (Array.isArray(value)) value.forEach((entry) => modelDescriptors(entry, pattern, output));
  else if (value && typeof value === "object") {
    const id = [value.id, value.slug, value.model, value.name]
      .find((candidate) => typeof candidate === "string" && pattern.test(candidate));
    if (id) {
      const allowed = ["id", "slug", "model", "name", "display_name",
        "supported_reasoning_efforts", "default_reasoning_effort", "context_window",
        "max_output_tokens", "input_token_limit", "output_token_limit",
        "max_context_length", "capabilities"];
      output.push(Object.fromEntries(allowed
        .filter((key) => value[key] !== undefined).map((key) => [key, value[key]])));
    } else Object.values(value).forEach((entry) => modelDescriptors(entry, pattern, output));
  }
  return output;
}

const resultRoot = process.env.BENCHMARK_RESULT_ROOT;
const ownerScope = process.env.BENCHMARK_OWNER_SCOPE;
if (!resultRoot || !ownerScope) throw new Error("Missing v101 catalogue configuration");
const receiptPath = resolve(resultRoot, "availability", "catalogs.json");
const lockPath = resolve(resultRoot, "availability", "catalogs.lock.json");
if (!await claimOnce(lockPath, receiptPath)) process.exit(0);

const meshPackage = JSON.parse(await readFile(
  "/workspace/node_modules/@sentropic/llm-mesh/package.json", "utf8"));
if (meshPackage.version !== "0.19.2") throw new Error("llm-mesh 0.19.2 is required");
const facade = createLlmMeshFacade({ mode: "cli",
  configResolver: { async resolveConfig() { return {}; } },
  keyring: new EncryptedFileKeyring("/run/benchmark-keyring") });
const accounts = await facade.listAccounts({ ownerScope });
const codexAccounts = accounts.filter(({ providerId }) => providerId === "codex");
if (codexAccounts.length !== 1) throw new Error("Expected one owner-scoped Codex enrollment");
const codex = codexAccounts[0];
const cloudAccounts = accounts.filter(({ providerId }) => providerId === "cloud-code");
if (cloudAccounts.length !== 1) throw new Error("Expected one owner-scoped Cloud Code enrollment");
const acquisition = await facade.acquire({ accountId: codex.accountId,
  ownerScopeRef: ownerScope, targetProviderId: "openai", transportProviderId: "codex",
  modelId: "gpt-5.6-sol", affinityKey: "v101-catalog", requestId: `v101-${Date.now()}` });
const auth = acquisition.material;
const codexHeaders = { authorization: `Bearer ${auth.accessToken}`, accept: "application/json",
  originator: "radar-refresh-benchmark", "user-agent": "radar-v101-model-probe",
  ...(auth.accountId ? { "chatgpt-account-id": auth.accountId } : {}) };
let codexModels;
let codexUsage;
try {
  [codexUsage, codexModels] = await Promise.all([
    getJson("https://chatgpt.com/backend-api/wham/usage", codexHeaders),
    getJson("https://chatgpt.com/backend-api/codex/models?client_version=0.154.0", codexHeaders),
  ]);
} finally {
  await facade.release(acquisition);
}

const cloudAcquisition = await facade.acquire({ accountId: cloudAccounts[0].accountId,
  ownerScopeRef: ownerScope, targetProviderId: "gemini", transportProviderId: "cloud-code",
  modelId: "gemini-3.8-flash", affinityKey: "v101-cloud-catalog",
  requestId: `v101-cloud-${Date.now()}` });
let cloudWire = null;
let cloudCatalogue;
try {
  cloudCatalogue = await fetchAvailableModels({
    accessToken: cloudAcquisition.material.accessToken,
    cloudaicompanionProject: cloudAcquisition.material.metadata?.cloudaicompanionProject,
    fetchFn: async (url, init = {}) => {
      const started = Date.now();
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
      cloudWire = { endpoint: endpointPath(url), httpStatus: response.status,
        durationMs: Date.now() - started };
      return response;
    },
  });
} finally {
  await facade.release(cloudAcquisition);
}

const openai = process.env.OPENAI_API_KEY
  ? await getJson("https://api.openai.com/v1/models",
    { authorization: `Bearer ${process.env.OPENAI_API_KEY}` }) : null;
const anthropic = process.env.ANTHROPIC_API_KEY
  ? await getJson("https://api.anthropic.com/v1/models?limit=1000",
    { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }) : null;
const mistral = process.env.MISTRAL_API_KEY
  ? await getJson("https://api.mistral.ai/v1/models",
    { authorization: `Bearer ${process.env.MISTRAL_API_KEY}` }) : null;
const requestedStatic = new Set(["gpt-5.6-luna", "gpt-5.6-sol", "gpt-6-astra",
  "claude-sonnet-5", "claude-opus-5", "mistral-small-2603", "gemini-3.8-flash"]);
const receipt = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  llmMesh: { version: meshPackage.version,
    requestedProfiles: listModelProfiles().filter(({ modelId }) => requestedStatic.has(modelId))
      .map(({ providerId, modelId }) => ({ providerId, modelId })) },
  keyring: { providerIds: [...new Set(accounts.map(({ providerId }) => providerId))].sort(),
    codexAccountPseudonym: `acct-${sha256(codex.accountId).slice(0, 10)}` },
  codex: { modelsHttpStatus: codexModels.httpStatus, modelsDurationMs: codexModels.durationMs,
    usageHttpStatus: codexUsage.httpStatus, usageDurationMs: codexUsage.durationMs,
    planType: codexUsage.payload?.plan_type ?? null,
    usedPercent: codexUsage.payload?.rate_limit?.primary_window?.used_percent ?? null,
    modelIds: collectIds(codexModels.payload, /^(?:gpt|codex)-/iu),
    descriptors: modelDescriptors(codexModels.payload, /^(?:gpt|codex)-/iu) },
  cloudCode: { ...cloudWire, modelIds: cloudCatalogue.models,
    tieredModelIds: cloudCatalogue.tieredModelIds },
  openai: { credential: openai ? "present" : "absent", httpStatus: openai?.httpStatus ?? null,
    durationMs: openai?.durationMs ?? null,
    modelIds: collectIds(openai?.payload, /^gpt-4\.1(?:-|$)/u), complete: Boolean(openai) },
  anthropic: { credential: anthropic ? "present" : "absent",
    httpStatus: anthropic?.httpStatus ?? null, durationMs: anthropic?.durationMs ?? null,
    modelIds: collectIds(anthropic?.payload, /^claude-(?:sonnet|opus)-5(?:-|$)/u),
    complete: Boolean(anthropic) && anthropic.payload?.has_more !== true },
  mistral: { credential: mistral ? "present" : "absent", httpStatus: mistral?.httpStatus ?? null,
    durationMs: mistral?.durationMs ?? null,
    modelIds: collectIds(mistral?.payload, /^mistral-small-(?:2603|latest)$/u),
    descriptors: modelDescriptors(mistral?.payload, /^mistral-small-(?:2603|latest)$/u),
    complete: Boolean(mistral) },
  requestCount: 3 + Number(Boolean(openai)) + Number(Boolean(anthropic)) + Number(Boolean(mistral)),
  redaction: { allowlistedFieldsOnly: true, secretsIncluded: false },
};
await writeOnce(receiptPath, receipt);
await completeClaim(lockPath, receiptPath);
console.log(JSON.stringify({ status: "completed", requestCount: receipt.requestCount,
  codexModels: receipt.codex.modelIds, openai: receipt.openai.modelIds,
  anthropic: receipt.anthropic.modelIds, mistral: receipt.mistral.modelIds }));
