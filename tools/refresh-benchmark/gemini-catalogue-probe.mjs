import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { CloudCodeRuntimeClient } from
  "/workspace/node_modules/@sentropic/llm-mesh/dist/index.js";
import { createLlmMeshFacade } from
  "/workspace/node_modules/@sentropic/llm-mesh/dist/service/facade.js";
import { EncryptedFileKeyring } from
  "/workspace/node_modules/@sentropic/llm-mesh/dist/node/index.js";
import { buildProbeRequest } from "./gemini-diagnostic.mjs";

const DAILY_HOST = "daily-cloudcode-pa.googleapis.com";
const STANDARD_HOST = "cloudcode-pa.googleapis.com";
const CATALOGUE_PATH = "/v1internal:fetchAvailableModels";
const STREAM_URL = `https://${DAILY_HOST}/v1internal:streamGenerateContent?alt=sse`;
const MODEL = "gemini-3.8-flash-low";
const DEFAULT_PROJECT = "default-cli-project";
const USER_AGENT =
  "antigravity/cli/1.1.10 (aidev_client; os_type=linux; arch=amd64; auth_method=consumer)";
const API_CLIENT = "gl-node/22.0.0 antigravity/0.1.0";
const CLIENT_METADATA = JSON.stringify({
  ideType: "ANTIGRAVITY",
  platform: "PLATFORM_UNSPECIFIED",
  pluginType: "ANTIGRAVITY",
});
const MAX_NETWORK_REQUESTS = 8;

const required = (name) => process.env[name]
  || (() => { throw new Error(`${name} is required`); })();
const outputPaths = {
  dP1: required("GEMINI_CATALOGUE_D_P1_OUTPUT"),
  dP2: required("GEMINI_CATALOGUE_D_P2_OUTPUT"),
  b2: required("GEMINI_PROBE_B2_OUTPUT"),
  e: required("GEMINI_PROBE_E_OUTPUT"),
  f: required("GEMINI_PROBE_F_OUTPUT"),
};
const ownerScope = required("BENCHMARK_OWNER_SCOPE");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const nowIso = () => new Date().toISOString();
const elapsed = (started) => Date.now() - started;
const discoveredProjectMask = "[REDACTED_LOAD_CODE_ASSIST_PROJECT]";

const nativeFetch = globalThis.fetch.bind(globalThis);
let networkRequestCount = 0;
globalThis.fetch = async (...args) => {
  if (networkRequestCount >= MAX_NETWORK_REQUESTS) {
    throw new Error(`Network request budget exhausted at ${MAX_NETWORK_REQUESTS}`);
  }
  networkRequestCount += 1;
  return nativeFetch(...args);
};

const sensitiveValues = new Set();
function sanitizeText(value) {
  let text = String(value ?? "").slice(0, 800);
  for (const sensitive of sensitiveValues) {
    if (sensitive) text = text.split(sensitive).join("[REDACTED]");
  }
  return text
    .replace(/(Bearer\s+)\S+/gi, "$1[REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/(access|refresh)[_-]?token["']?\s*[:=]\s*["']?[^"'\s,}]+/gi,
      "$1Token=[REDACTED]");
}

function maskProject(project) {
  return project === DEFAULT_PROJECT ? DEFAULT_PROJECT : discoveredProjectMask;
}

function redactedHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key,
    key.toLowerCase() === "authorization" ? "Bearer [REDACTED]" : value,
  ]));
}

function alignedHeaders({ accept = "application/json" } = {}) {
  return {
    Authorization: `Bearer ${activeAccessToken}`,
    "User-Agent": USER_AGENT,
    "Content-Type": "application/json",
    Accept: accept,
    "X-Goog-Api-Client": API_CLIENT,
    "Client-Metadata": CLIENT_METADATA,
  };
}

function payloadMessage(payload, fallback) {
  const candidate = payload?.error && typeof payload.error === "object"
    ? payload.error.message
    : payload?.message;
  return sanitizeText(typeof candidate === "string" ? candidate : fallback);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function responseStructure(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { type: payload === null ? "null" : typeof payload };
  }
  const fieldType = (value) => Array.isArray(value)
    ? "array" : value === null ? "null" : typeof value;
  const models = payload.models && typeof payload.models === "object"
    && !Array.isArray(payload.models) ? payload.models : {};
  const modelEntryFields = new Set();
  for (const descriptor of Object.values(models)) {
    if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) continue;
    Object.keys(descriptor).forEach((field) => modelEntryFields.add(field));
  }
  return {
    type: "object",
    topLevelFields: Object.keys(payload).sort(),
    topLevelFieldTypes: Object.fromEntries(Object.entries(payload)
      .map(([key, value]) => [key, fieldType(value)]).sort(([left], [right]) =>
        left.localeCompare(right))),
    models: {
      type: "object keyed by wire model id",
      count: Object.keys(models).length,
      entryFields: [...modelEntryFields].sort(),
    },
    tieredModelIds: payload.tieredModelIds && typeof payload.tieredModelIds === "object"
      ? Object.fromEntries(Object.entries(payload.tieredModelIds)
        .map(([key, value]) => [key, {
          type: fieldType(value),
          ...(Array.isArray(value) ? { length: value.length } : {}),
        }]).sort(([left], [right]) => left.localeCompare(right)))
      : null,
  };
}

function catalogueModels(payload) {
  const models = payload?.models && typeof payload.models === "object"
    && !Array.isArray(payload.models) ? payload.models : {};
  const ids = Object.keys(models).sort();
  const flashLowIds = new Set();
  for (const [id, descriptor] of Object.entries(models)) {
    const descriptorText = JSON.stringify(descriptor ?? "");
    if (/flash/i.test(`${id} ${descriptorText}`) && /low/i.test(`${id} ${descriptorText}`)) {
      flashLowIds.add(id);
    }
  }
  return {
    ids,
    flashLowIds: [...flashLowIds].sort(),
  };
}

function parseStreamText(text) {
  const content = [];
  let providerError = null;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    const parsed = parseJson(data);
    const payload = parsed?.response ?? parsed;
    if (!payload) continue;
    if (payload.error) providerError = payload.error;
    for (const part of payload.candidates?.[0]?.content?.parts ?? []) {
      if (typeof part.text === "string" && !part.thought) content.push(part.text);
    }
  }
  const json = parseJson(text);
  const jsonPayload = json?.response ?? json;
  if (jsonPayload?.error) providerError = jsonPayload.error;
  for (const part of jsonPayload?.candidates?.[0]?.content?.parts ?? []) {
    if (typeof part.text === "string" && !part.thought) content.push(part.text);
  }
  return { output: content.join("").trim(), providerError };
}

async function writeReceipt(path, receipt) {
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
}

let activeAccessToken = "";

async function cataloguePing({ project, projectLabel, outputPath }) {
  const startedAt = nowIso();
  const totalStarted = Date.now();
  const envelope = { project };
  const headers = alignedHeaders();
  const attempts = [];
  let finalPayload = null;
  let finalStatus = null;
  let finalMessage = "N-A";
  let finalEndpoint = null;

  for (const host of [DAILY_HOST, STANDARD_HOST]) {
    const endpoint = `https://${host}${CATALOGUE_PATH}`;
    const attemptStarted = Date.now();
    let response;
    let payload = null;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(envelope),
      });
      const text = await response.text();
      payload = parseJson(text);
      const message = payloadMessage(payload, response.statusText || "N-A");
      attempts.push({
        networkRequestOrdinal: networkRequestCount,
        endpoint,
        httpStatus: response.status,
        message,
        durationMs: elapsed(attemptStarted),
      });
      finalPayload = payload;
      finalStatus = response.status;
      finalMessage = message;
      finalEndpoint = endpoint;
      if (response.ok) break;
    } catch (error) {
      const message = sanitizeText(error instanceof Error ? error.message : error);
      attempts.push({
        networkRequestOrdinal: networkRequestCount,
        endpoint,
        httpStatus: null,
        message,
        durationMs: elapsed(attemptStarted),
      });
      finalPayload = null;
      finalStatus = null;
      finalMessage = message;
      finalEndpoint = endpoint;
    }
  }

  const announced = catalogueModels(finalPayload);
  const receipt = {
    schemaVersion: 1,
    ping: projectLabel === "p1" ? "D-p1" : "D-p2",
    startedAt,
    completedAt: nowIso(),
    durationMs: elapsed(totalStarted),
    project: projectLabel === "p1"
      ? "p1 (loadCodeAssist-derived; value redacted)"
      : DEFAULT_PROJECT,
    request: {
      method: "POST",
      endpoint: finalEndpoint,
      envelope: { project: maskProject(project) },
      headers: redactedHeaders(headers),
    },
    attempts,
    httpStatus: finalStatus,
    message: finalMessage,
    announced: { modelIds: announced.ids },
    responseFieldStructure: responseStructure(finalPayload),
    networkRequestsSoFar: networkRequestCount,
  };
  await writeReceipt(outputPath, receipt);
  return { receipt, ...announced };
}

async function alignedStreamPing({ ping, project, projectLabel, model, outputPath }) {
  const startedAt = nowIso();
  const started = Date.now();
  const headers = alignedHeaders({ accept: "text/event-stream" });
  const envelope = {
    project,
    request: {
      contents: [{ role: "user", parts: [{ text: "Reply with PING_OK only." }] }],
      generationConfig: {
        maxOutputTokens: 64,
        thinkingConfig: { thinkingLevel: "LOW" },
      },
    },
    model,
  };
  let status = null;
  let statusText = "N-A";
  let parsed = { output: "", providerError: null };
  try {
    const response = await fetch(STREAM_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(envelope),
    });
    status = response.status;
    statusText = response.statusText || "N-A";
    parsed = parseStreamText(await response.text());
  } catch (error) {
    statusText = sanitizeText(error instanceof Error ? error.message : error);
  }
  const message = parsed.providerError
    ? payloadMessage({ error: parsed.providerError }, statusText)
    : sanitizeText(parsed.output || statusText);
  const receipt = {
    schemaVersion: 1,
    ping,
    startedAt,
    completedAt: nowIso(),
    durationMs: elapsed(started),
    project: projectLabel === "p1"
      ? "p1 (loadCodeAssist-derived; value redacted)"
      : DEFAULT_PROJECT,
    requested: { model, providerEffort: "LOW", maxOutputTokens: 64 },
    request: {
      method: "POST",
      endpoint: STREAM_URL,
      envelope: { ...envelope, project: maskProject(project) },
      headers: redactedHeaders(headers),
    },
    networkRequestOrdinal: networkRequestCount,
    httpStatus: status,
    message,
    actual: {
      output: sanitizeText(parsed.output),
      pingExact: parsed.output === "PING_OK",
    },
    networkRequestsSoFar: networkRequestCount,
  };
  await writeReceipt(outputPath, receipt);
  return receipt;
}

async function transportPingE({ acquisition, outputPath }) {
  const startedAt = nowIso();
  const started = Date.now();
  let observed = null;
  let responseBodyPromise = null;
  let generated = null;
  let error = null;

  const observedFetch = async (url, init = {}) => {
    const body = parseJson(String(init.body ?? ""));
    observed = {
      endpoint: String(url),
      method: init.method ?? "GET",
      headers: redactedHeaders(init.headers ?? {}),
      envelope: {
        ...body,
        project: maskProject(body?.project),
        requestId: body?.requestId ? "[REDACTED_REQUEST_ID]" : undefined,
      },
      networkRequestOrdinal: networkRequestCount + 1,
    };
    const response = await fetch(url, init);
    observed.httpStatus = response.status;
    observed.statusText = response.statusText || "N-A";
    responseBodyPromise = response.clone().text();
    return response;
  };

  const material = {
    ...acquisition.material,
    metadata: {
      ...(acquisition.material.metadata ?? {}),
      cloudaicompanionProject: DEFAULT_PROJECT,
    },
  };
  try {
    const client = new CloudCodeRuntimeClient(observedFetch);
    generated = await client.generate(buildProbeRequest({ model: MODEL, effort: "low" }),
      { auth: material });
  } catch (caught) {
    error = sanitizeText(caught instanceof Error ? caught.message : caught);
  }
  const responseText = responseBodyPromise ? await responseBodyPromise.catch(() => "") : "";
  const parsed = parseStreamText(responseText);
  const message = parsed.providerError
    ? payloadMessage({ error: parsed.providerError }, observed?.statusText ?? error ?? "N-A")
    : sanitizeText(generated?.text?.trim() || parsed.output || error || observed?.statusText || "N-A");
  const receipt = {
    schemaVersion: 1,
    ping: "E",
    startedAt,
    completedAt: nowIso(),
    durationMs: elapsed(started),
    project: DEFAULT_PROJECT,
    requested: {
      package: "@sentropic/llm-mesh@0.19.1",
      transport: "CloudCodeRuntimeClient unchanged",
      model: MODEL,
      providerEffort: "LOW",
      maxOutputTokens: 64,
    },
    request: observed,
    httpStatus: observed?.httpStatus ?? null,
    message,
    actual: {
      output: sanitizeText(generated?.text?.trim() || parsed.output),
      pingExact: (generated?.text?.trim() || parsed.output) === "PING_OK",
    },
    localError: error,
    networkRequestsSoFar: networkRequestCount,
  };
  await writeReceipt(outputPath, receipt);
  return receipt;
}

async function main() {
  const packageJsonUrl = new URL(
    "file:///workspace/node_modules/@sentropic/llm-mesh/package.json");
  const packageData = JSON.parse(await readFile(fileURLToPath(packageJsonUrl), "utf8"));
  if (packageData.version !== "0.19.1") {
    throw new Error(`Expected @sentropic/llm-mesh@0.19.1, got ${packageData.version}`);
  }

  const keyring = new EncryptedFileKeyring("/run/benchmark-keyring");
  const facade = createLlmMeshFacade({
    mode: "cli",
    configResolver: { async resolveConfig() { return {}; } },
    keyring,
  });
  const accounts = await facade.listAccounts({ ownerScope });
  const eligible = accounts.filter(({ providerId }) => providerId === "cloud-code");
  if (eligible.length !== 1) {
    throw new Error(`Expected one owner-scoped Cloud Code enrollment, found ${eligible.length}`);
  }
  const account = eligible[0];
  const acquisition = await facade.acquire({
    accountId: account.accountId,
    ownerScopeRef: ownerScope,
    targetProviderId: "gemini",
    transportProviderId: "cloud-code",
    modelId: MODEL,
    affinityKey: "refresh-benchmark-gemini-catalogue-probe",
    requestId: `gemini-catalogue-probe-${Date.now()}`,
  });
  try {
    activeAccessToken = acquisition.material.accessToken;
    const discoveredProject = acquisition.material.metadata?.cloudaicompanionProject;
    if (!activeAccessToken || typeof discoveredProject !== "string" || !discoveredProject.trim()) {
      throw new Error("Acquisition is missing access token or discovered project");
    }
    sensitiveValues.add(activeAccessToken);
    sensitiveValues.add(acquisition.material.refreshToken);
    sensitiveValues.add(discoveredProject);
    sensitiveValues.add(account.accountId);
    sensitiveValues.add(ownerScope);

    const dP1 = await cataloguePing({
      project: discoveredProject.trim(), projectLabel: "p1", outputPath: outputPaths.dP1,
    });
    const dP2 = await cataloguePing({
      project: DEFAULT_PROJECT, projectLabel: "p2", outputPath: outputPaths.dP2,
    });
    const selected = dP1.ids.length > 0
      ? { project: discoveredProject.trim(), projectLabel: "p1", catalogue: dP1 }
      : { project: DEFAULT_PROJECT, projectLabel: "p2", catalogue: dP2 };

    const b2 = await alignedStreamPing({
      ping: "B2",
      project: selected.project,
      projectLabel: selected.projectLabel,
      model: MODEL,
      outputPath: outputPaths.b2,
    });
    const e = await transportPingE({ acquisition, outputPath: outputPaths.e });

    const alternate = selected.catalogue.flashLowIds
      .filter((id) => id !== MODEL)
      .sort((left, right) => Number(/3[.-]8/.test(right)) - Number(/3[.-]8/.test(left))
        || left.localeCompare(right))[0];
    let f = null;
    if (!selected.catalogue.ids.includes(MODEL) && alternate) {
      f = await alignedStreamPing({
        ping: "F",
        project: selected.project,
        projectLabel: selected.projectLabel,
        model: alternate,
        outputPath: outputPaths.f,
      });
    }

    const safeSummary = {
      account: `acct-${sha256(account.accountId).slice(0, 10)}`,
      requests: networkRequestCount,
      dP1: dP1.receipt.httpStatus,
      dP2: dP2.receipt.httpStatus,
      b2: b2.httpStatus,
      e: e.httpStatus,
      f: f?.httpStatus ?? "N-A",
    };
    console.log(JSON.stringify(safeSummary));
  } finally {
    await facade.release(acquisition);
  }
}

await main().catch((error) => {
  console.error(`Gemini catalogue probe failed: ${sanitizeText(
    error instanceof Error ? error.message : error)}`);
  process.exitCode = 1;
});
