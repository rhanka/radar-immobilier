import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import { CloudCodeRuntimeClient, getModelProfile } from
  "/workspace/node_modules/@sentropic/llm-mesh-refresh/dist/index.js";
import { createLlmMeshFacade } from
  "/workspace/node_modules/@sentropic/llm-mesh-refresh/dist/service/facade.js";
import { EncryptedFileKeyring } from
  "/workspace/node_modules/@sentropic/llm-mesh-refresh/dist/node/index.js";
import {
  CLOUD_CODE_ENDPOINTS,
  buildProbeRequest,
  sanitizeCloudCodeError,
} from "./gemini-diagnostic.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const required = (name) => process.env[name]
  || (() => { throw new Error(`${name} is required`); })();
const ownerScope = required("BENCHMARK_OWNER_SCOPE");
const outputPath = required("BENCHMARK_PREFLIGHT_OUTPUT");
const model = process.env.BENCHMARK_MODEL ?? "gemini-3.8-flash";
const effortValue = process.env.BENCHMARK_EFFORT ?? "low";
const effort = effortValue === "omit" ? undefined : effortValue;
if (effort && !["low", "medium", "high"].includes(effort)) {
  throw new Error("BENCHMARK_EFFORT must be omit, low, medium, or high");
}
const endpointName = process.env.BENCHMARK_ENDPOINT ?? "mesh";
const endpoint = CLOUD_CODE_ENDPOINTS[endpointName];
if (!endpoint) throw new Error("BENCHMARK_ENDPOINT must be mesh or agy");

const keyring = new EncryptedFileKeyring("/run/benchmark-keyring");
const facade = createLlmMeshFacade({ mode: "cli",
  configResolver: { async resolveConfig() { return {}; } }, keyring });
const accounts = await facade.listAccounts({ ownerScope });
const eligible = accounts.filter(({ providerId }) => providerId === "cloud-code");
if (eligible.length !== 1) {
  throw new Error(`Expected one owner-scoped Cloud Code enrollment, found ${eligible.length}`);
}
const account = eligible[0];
const publicRaw = await keyring.getSecret(`sentropic-llm-mesh:${account.accountId}:public`);
const publicRecord = publicRaw ? JSON.parse(publicRaw) : null;
const packageData = JSON.parse(await readFile(
  "/workspace/node_modules/@sentropic/llm-mesh-refresh/package.json", "utf8"));
const profile = getModelProfile("gemini", model);
const acquisition = await facade.acquire({ accountId: account.accountId,
  ownerScopeRef: ownerScope, targetProviderId: "gemini", transportProviderId: "cloud-code",
  modelId: model, affinityKey: "refresh-benchmark-gemini-diagnostic",
  requestId: `gemini-diagnostic-${Date.now()}` });

let wire = null;
const observedFetch = async (url, init) => {
  const bodyText = String(init?.body ?? "");
  const body = JSON.parse(bodyText);
  const response = await fetch(endpoint, init);
  const errorPayload = response.ok ? null : await response.clone().json().catch(() => null);
  wire = {
    adapterEndpoint: String(url),
    effectiveEndpoint: endpoint,
    httpStatus: response.status,
    model: body.model ?? null,
    providerEffort: body.request?.generationConfig?.thinkingConfig?.thinkingLevel ?? null,
    maxOutputTokens: body.request?.generationConfig?.maxOutputTokens ?? null,
    bodySha256: sha256(bodyText),
    envelopeFields: Object.keys(body).sort(),
    requestFields: Object.keys(body.request ?? {}).sort(),
    providerError: errorPayload ? sanitizeCloudCodeError(errorPayload) : null,
  };
  return response;
};

const startedAt = new Date();
let response = null;
let error = null;
try {
  const client = new CloudCodeRuntimeClient(observedFetch);
  response = await client.generate(buildProbeRequest({ model, effort }), { auth: acquisition.material });
} catch (caught) {
  error = caught instanceof Error
    ? { name: caught.name, message: caught.message.slice(0, 300) }
    : { message: "non-Error failure" };
} finally {
  await facade.release(acquisition);
}
const completedAt = new Date();
const receipt = {
  schemaVersion: 1,
  startedAt: startedAt.toISOString(),
  completedAt: completedAt.toISOString(),
  durationMs: completedAt - startedAt,
  status: error ? "failed" : "completed",
  requested: { model, effort: effort ?? null, endpoint: endpointName },
  account: {
    pseudonym: `acct-${sha256(account.accountId).slice(0, 10)}`,
    explicitModelIds: publicRecord?.account?.modelIds ?? null,
  },
  installedPackage: {
    name: packageData.name,
    version: packageData.version,
    staticModelProfilePresent: Boolean(profile),
  },
  wire,
  actual: response ? {
    providerId: response.providerId,
    modelId: response.modelId,
    outputSha256: sha256(response.text ?? ""),
    pingExact: response.text?.trim() === "PING_OK",
    usage: response.usage ?? null,
  } : null,
  error,
};
await writeFile(outputPath, JSON.stringify(receipt), { flag: "wx" });
console.log(JSON.stringify(receipt));
if (error || !receipt.actual?.pingExact) process.exitCode = 1;
