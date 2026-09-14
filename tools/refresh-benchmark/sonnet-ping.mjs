import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { CloudCodeRuntimeClient } from
  "/workspace/node_modules/@sentropic/llm-mesh/dist/index.js";
import { createLlmMeshFacade } from
  "/workspace/node_modules/@sentropic/llm-mesh/dist/service/facade.js";
import { EncryptedFileKeyring } from
  "/workspace/node_modules/@sentropic/llm-mesh/dist/node/index.js";

const required = (name) => process.env[name]
  || (() => { throw new Error(`${name} is required`); })();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sanitize = (value) => String(value ?? "N-A").slice(0, 500)
  .replace(/sk-ant-[A-Za-z0-9_-]+/gu, "[REDACTED]")
  .replace(/(Bearer\s+)\S+/giu, "$1[REDACTED]");
const mode = required("BENCHMARK_SONNET_TRANSPORT");
const outputPath = required("BENCHMARK_PING_OUTPUT");
const model = "claude-sonnet-4-6";
if (!["direct", "cloudcode"].includes(mode)) throw new Error("Unsupported Sonnet transport");

let wire = null;
let actual = null;
let error = null;
let account = null;
const started = Date.now();

if (mode === "direct") {
  const bodyText = JSON.stringify({ model, max_tokens: 64,
    messages: [{ role: "user", content: "Reply with PING_OK only." }] });
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json",
        "x-api-key": required("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" },
      body: bodyText,
    });
    const responseText = await response.text();
    const payload = JSON.parse(responseText);
    const messageExact = response.ok
      ? (payload.content ?? []).filter(({ type }) => type === "text")
        .map(({ text }) => text).join("").trim()
      : sanitize(payload?.error?.message ?? response.statusText);
    wire = { endpoint: "https://api.anthropic.com/v1/messages", httpStatus: response.status,
      requestBodySha256: sha256(bodyText), model: payload.model ?? model, maxOutputTokens: 64,
      requestId: response.headers.get("request-id") };
    actual = response.ok ? { providerId: "anthropic", modelId: payload.model ?? model,
      responseId: payload.id ?? null, finishReason: payload.stop_reason ?? null,
      messageExact, pingExact: messageExact === "PING_OK", usage: payload.usage ?? null } : null;
    if (!response.ok) error = { message: messageExact };
  } catch (caught) {
    error = { message: sanitize(caught instanceof Error ? caught.message : caught) };
  }
} else {
  const ownerScope = required("BENCHMARK_OWNER_SCOPE");
  const keyring = new EncryptedFileKeyring("/run/benchmark-keyring");
  const facade = createLlmMeshFacade({ mode: "cli",
    configResolver: { async resolveConfig() { return {}; } }, keyring });
  const accounts = await facade.listAccounts({ ownerScope });
  const eligible = accounts.filter(({ providerId }) => providerId === "cloud-code");
  if (eligible.length !== 1) throw new Error(`Expected one Cloud Code enrollment, found ${eligible.length}`);
  account = eligible[0];
  const acquisition = await facade.acquire({ accountId: account.accountId,
    ownerScopeRef: ownerScope, targetProviderId: "gemini", transportProviderId: "cloud-code",
    modelId: model, affinityKey: "refresh-benchmark-sonnet-ping",
    requestId: `sonnet-ping-${Date.now()}` });
  const observedFetch = async (url, init) => {
    const bodyText = String(init?.body ?? "");
    const body = JSON.parse(bodyText);
    const fetchStarted = Date.now();
    const response = await fetch(url, init);
    wire = { endpoint: String(url), httpStatus: response.status,
      durationMs: Date.now() - fetchStarted, requestBodySha256: sha256(bodyText),
      model: body.model ?? null,
      providerEffort: body.request?.generationConfig?.thinkingConfig?.thinkingLevel ?? null,
      maxOutputTokens: body.request?.generationConfig?.maxOutputTokens ?? null,
      requestId: response.headers.get("x-request-id") };
    return response;
  };
  try {
    const response = await new CloudCodeRuntimeClient(observedFetch).generate({ modelId: model,
      messages: [{ role: "user", content: "Reply with PING_OK only." }],
      reasoning: { effort: "low" }, maxOutputTokens: 64 }, { auth: acquisition.material });
    const messageExact = response.text?.trim() ?? "";
    actual = { providerId: response.providerId, modelId: response.modelId,
      responseId: response.id ?? null, finishReason: response.finishReason ?? null,
      messageExact, pingExact: messageExact === "PING_OK", usage: response.usage ?? null };
  } catch (caught) {
    error = { message: sanitize(caught instanceof Error ? caught.message : caught) };
  } finally {
    await facade.release(acquisition);
  }
}

const completed = Date.now();
const receipt = { schemaVersion: 1, transport: mode, model,
  requested: { maxOutputTokens: 64, effort: mode === "cloudcode" ? "low" : null },
  httpStatus: wire?.httpStatus ?? null, messageExact: actual?.messageExact ?? error?.message ?? "N-A",
  latencyMs: completed - started, wire, actual, error,
  accountPseudonym: account ? `acct-${sha256(account.accountId).slice(0, 10)}` : "env:ANTHROPIC_API_KEY",
  redaction: { secretsIncluded: false } };
await writeFile(outputPath, JSON.stringify(receipt), { flag: "wx" });
console.log(JSON.stringify({ transport: mode, httpStatus: receipt.httpStatus,
  messageExact: receipt.messageExact, latencyMs: receipt.latencyMs }));
if (receipt.httpStatus !== 200 || actual?.pingExact !== true) process.exitCode = 1;
