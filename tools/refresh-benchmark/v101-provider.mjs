import { createHash } from "node:crypto";

import { endpointPath, safeUsage, textFromOpenAi } from "./v101-probe-lib.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const limitNames = ["retry-after", "x-ratelimit-limit-requests", "x-ratelimit-limit-tokens",
  "x-ratelimit-remaining-requests", "x-ratelimit-remaining-tokens",
  "x-ratelimit-reset-requests", "x-ratelimit-reset-tokens",
  "anthropic-ratelimit-requests-limit", "anthropic-ratelimit-tokens-limit"];

export class ProviderError extends Error {
  constructor(code, { httpStatus = null, headers = {}, wire = null } = {}) {
    super(code); this.name = "ProviderError"; this.code = code;
    this.httpStatus = httpStatus; this.headers = headers; this.wire = wire;
  }
}

function rateHeaders(headers) {
  return Object.fromEntries(limitNames.map((name) => [name, headers.get(name)])
    .filter(([, value]) => value !== null));
}

function inspectSse(contentType, transcript) {
  if (!contentType.includes("text/event-stream")) return { expected: false, terminal: true };
  let dataEvents = 0; let doneMarker = false; let terminalEvent = null;
  let finishReason = null; let usage = null;
  for (const line of transcript.split(/\r?\n/u)) {
    if (!line.trim().startsWith("data:")) continue;
    const data = line.trim().slice(5).trim();
    if (data === "[DONE]") { doneMarker = true; continue; }
    try {
      const parsed = JSON.parse(data); dataEvents += 1;
      const payload = parsed.response ?? parsed;
      if (["response.completed", "response.failed", "response.incomplete"].includes(parsed.type)) {
        terminalEvent = parsed.type;
      }
      finishReason = payload.candidates?.[0]?.finishReason ?? finishReason;
      const rawUsage = payload.usageMetadata ?? payload.usage;
      if (rawUsage && typeof rawUsage === "object") usage = safeUsage(rawUsage) ?? rawUsage;
    } catch { /* The clients ignore malformed SSE data lines too. */ }
  }
  return { expected: true, terminal: doneMarker || terminalEvent !== null || finishReason !== null,
    dataEvents, doneMarker, terminalEvent, finishReason, usage };
}

function wireFields(arm, body) {
  if (arm.transport === "cloud-code") return {
    model: body?.model ?? null,
    effort: body?.request?.generationConfig?.thinkingConfig?.thinkingLevel ?? null,
    maxOutputTokens: body?.request?.generationConfig?.maxOutputTokens ?? null,
  };
  if (arm.transport === "anthropic-api") return { model: body?.model ?? null,
    effort: body?.output_config?.effort ?? null, maxOutputTokens: body?.max_tokens ?? null };
  if (arm.transport === "mistral-api") return { model: body?.model ?? null,
    effort: null, maxOutputTokens: body?.max_tokens ?? null };
  return { model: body?.model ?? null, effort: body?.reasoning?.effort ?? null,
    maxOutputTokens: body?.max_output_tokens ?? null };
}

function normalizedUsage(value) {
  if (!value) return null;
  const inputTokens = value.inputTokens ?? value.input_tokens ?? value.prompt_tokens
    ?? value.promptTokenCount;
  const outputTokens = value.outputTokens ?? value.output_tokens ?? value.completion_tokens
    ?? value.candidatesTokenCount;
  const totalTokens = value.totalTokens ?? value.total_tokens ?? value.totalTokenCount
    ?? (Number.isFinite(inputTokens) && Number.isFinite(outputTokens)
      ? inputTokens + outputTokens : undefined);
  const thoughtsTokenCount = value.thoughtsTokenCount
    ?? value.output_tokens_details?.reasoning_tokens;
  return Number.isFinite(inputTokens) && Number.isFinite(outputTokens)
    ? { inputTokens, outputTokens, totalTokens: Number.isFinite(totalTokens) ? totalTokens : null,
      ...(Number.isFinite(thoughtsTokenCount) ? { thoughtsTokenCount } : {}) }
    : null;
}

function directResult(arm, payload) {
  if (arm.transport === "openai-api") return { id: payload.id ?? null,
    modelId: payload.model ?? arm.model, text: textFromOpenAi(payload),
    finishReason: payload.incomplete_details?.reason ?? payload.status ?? null,
    usage: normalizedUsage(payload.usage) };
  if (arm.transport === "anthropic-api") {
    const text = (payload.content ?? []).filter(({ type }) => type === "text")
      .map(({ text: value }) => value).join("");
    return { id: payload.id ?? null, modelId: payload.model ?? arm.model, text,
      finishReason: payload.stop_reason ?? null, usage: normalizedUsage(payload.usage) };
  }
  return { id: payload.id ?? null, modelId: payload.model ?? arm.model,
    text: String(payload.choices?.[0]?.message?.content ?? ""),
    finishReason: payload.choices?.[0]?.finish_reason ?? null,
    usage: normalizedUsage(payload.usage) };
}

function directRequest(arm, messages, maxOutputTokens) {
  if (arm.transport === "openai-api") return {
    url: "https://api.openai.com/v1/responses",
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}` },
    body: { model: arm.model, input: messages, max_output_tokens: maxOutputTokens },
    credential: process.env.OPENAI_API_KEY,
  };
  if (arm.transport === "anthropic-api") return {
    url: "https://api.anthropic.com/v1/messages",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01" }, credential: process.env.ANTHROPIC_API_KEY,
    body: { model: arm.model, max_tokens: maxOutputTokens,
      system: messages.filter(({ role }) => role === "system").map(({ content }) => content).join("\n\n"),
      messages: messages.filter(({ role }) => role !== "system"),
      ...(arm.effort ? { thinking: { type: "adaptive" }, output_config: { effort: arm.effort } } : {}) },
  };
  return { url: "https://api.mistral.ai/v1/chat/completions",
    headers: { authorization: `Bearer ${process.env.MISTRAL_API_KEY ?? ""}` },
    credential: process.env.MISTRAL_API_KEY,
    body: { model: arm.model, max_tokens: maxOutputTokens, messages,
      response_format: { type: "json_object" } } };
}

export async function createProvider(arm, { beforeRequest, timeoutMs }) {
  let facade = null; let account = null; let mesh = null; let recentWire = null;
  if (["codex", "cloud-code"].includes(arm.transport)) {
    const module = await import("/workspace/node_modules/@sentropic/llm-mesh/dist/index.js");
    const { createLlmMeshFacade } = await import(
      "/workspace/node_modules/@sentropic/llm-mesh/dist/service/facade.js");
    const { EncryptedFileKeyring } = await import(
      "/workspace/node_modules/@sentropic/llm-mesh/dist/node/index.js");
    facade = createLlmMeshFacade({ mode: "cli", configResolver: { async resolveConfig() { return {}; } },
      keyring: new EncryptedFileKeyring("/run/benchmark-keyring") });
    const accounts = await facade.listAccounts({ ownerScope: process.env.BENCHMARK_OWNER_SCOPE });
    const matches = accounts.filter(({ providerId }) => providerId === arm.transport);
    if (matches.length !== 1) throw new ProviderError("ACCOUNT_SELECTION_FAILED");
    account = matches[0];
    mesh = { CodexRuntimeClient: module.CodexRuntimeClient,
      CloudCodeRuntimeClient: module.CloudCodeRuntimeClient };
  }

  async function observedFetch(url, init = {}) {
    beforeRequest();
    const started = Date.now();
    const bodyText = String(init.body ?? "");
    let body = null; try { body = JSON.parse(bodyText); } catch { /* recorded as null */ }
    const fields = wireFields(arm, body);
    const generationRequest = !String(url).includes("fetchAvailableModels");
    if (generationRequest && arm.capEnforced !== false && fields.maxOutputTokens !== 32_768) {
      throw new ProviderError("CAP_NOT_MATERIALIZED", { wire: fields });
    }
    if (generationRequest && arm.capEnforced === false && fields.maxOutputTokens !== null) {
      throw new ProviderError("CAP_EXCEPTION_DRIFT", { wire: fields });
    }
    const controller = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, controller]) : controller;
    let response;
    try { response = await fetch(url, { ...init, signal }); }
    catch (error) { throw new ProviderError(error?.code ?? error?.cause?.code ?? "NETWORK_ERROR"); }
    const transcript = await response.clone().text();
    const headers = rateHeaders(response.headers);
    const wire = { endpoint: endpointPath(url), method: init.method ?? "POST",
      requestBodySha256: sha256(bodyText), inputBytes: Buffer.byteLength(bodyText), ...fields,
      httpStatus: response.status, durationMs: Date.now() - started,
      requestId: response.headers.get("x-request-id") ?? response.headers.get("openai-request-id"),
      terminalSse: inspectSse(response.headers.get("content-type") ?? "", transcript), headers };
    recentWire = wire;
    if (!response.ok) throw new ProviderError(`HTTP_${response.status}`,
      { httpStatus: response.status, headers, wire });
    return response;
  }

  return { accountPseudonym: account ? `acct-${sha256(account.accountId).slice(0, 10)}` : `env:${
    arm.transport.toUpperCase()}`,
  async generate(messages, affinityKey) {
    if (!["codex", "cloud-code"].includes(arm.transport)) {
      const request = directRequest(arm, messages, 32_768);
      if (!request.credential) throw new ProviderError("CREDENTIAL_ABSENT");
      const response = await observedFetch(request.url, { method: "POST",
        headers: { "content-type": "application/json", ...request.headers },
        body: JSON.stringify(request.body) });
      const payload = await response.json().catch(() => { throw new ProviderError("INVALID_RESPONSE_JSON"); });
      return { ...directResult(arm, payload), wire: recentWire };
    }
    const acquisition = await facade.acquire({ accountId: account.accountId,
      ownerScopeRef: process.env.BENCHMARK_OWNER_SCOPE,
      targetProviderId: arm.transport === "codex" ? "openai" : "gemini",
      transportProviderId: arm.transport, modelId: arm.model, affinityKey,
      requestId: `v101-${arm.name}-${affinityKey}` });
    const fetchWithWire = async (...args) => {
      try { const response = await observedFetch(...args); return response; }
      catch (error) { if (error?.wire) recentWire = error.wire; throw error; }
    };
    try {
      const client = arm.transport === "codex"
        ? new mesh.CodexRuntimeClient({ fetch: fetchWithWire })
        : new mesh.CloudCodeRuntimeClient(fetchWithWire);
      const result = await client.generate({ modelId: arm.model, messages,
        ...(arm.effort ? { reasoning: { effort: arm.effort } } : {}),
        responseFormat: { type: "json-object" }, maxOutputTokens: 32_768,
        signal: AbortSignal.timeout(timeoutMs) }, { auth: acquisition.material });
      return { id: result.id ?? null, modelId: result.modelId ?? arm.model,
        text: result.text ?? "", finishReason: result.finishReason ?? null,
        usage: normalizedUsage(result.usage), wire: recentWire };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(error?.code ?? error?.cause?.code ?? "TRANSPORT_ERROR", {
        httpStatus: recentWire?.httpStatus ?? null, headers: recentWire?.headers ?? {},
        wire: recentWire });
    } finally { await facade.release(acquisition); }
  } };
}
