import { executionContract } from "./integration-contract.mjs";

export const variants = Object.freeze({
  "luna-low": { provider: "openai", transport: "codex", model: "gpt-5.6-luna", effort: "low" },
  // Wire ID announced by fetchAvailableModels; replace with llm-mesh 0.19.2 mapping.
  "gemini-low": { provider: "gemini", transport: "cloud-code", model: "gemini-3.8-flash-tiered", effort: "low" },
  "gemini-high": { provider: "gemini", transport: "cloud-code", model: "gemini-3.8-flash-tiered", effort: "high" },
  "sonnet-direct": { provider: "anthropic", transport: "anthropic-direct",
    model: "claude-sonnet-4-6", effort: null },
  "sonnet-cloudcode": { provider: "anthropic", transport: "cloud-code",
    model: "claude-sonnet-4-6", effort: "low" },
});

export function createAdapterSet(constructors, observedFetch) {
  const { CloudCodeRuntimeClient, CodexRuntimeClient, GeminiAdapter, OpenAIAdapter,
    getModelProfile } = constructors;
  const baseGemini = getModelProfile("gemini", "gemini-3.8-flash");
  if (!baseGemini) throw new Error("Gemini 3.8 base profile is unavailable");
  return Object.freeze({
    gemini: new GeminiAdapter({ client: new CloudCodeRuntimeClient(observedFetch),
      models: [{ ...baseGemini, modelId: variants["gemini-high"].model }] }),
    openai: new OpenAIAdapter({ client: new CodexRuntimeClient({ fetch: observedFetch }) }),
  });
}

export function validateRetry({ attemptNumber, retryReason, previousReceipt }) {
  if (attemptNumber === 1) return;
  if (attemptNumber !== executionContract.maxAttempts || !retryReason) {
    throw new Error(`Attempt ${executionContract.maxAttempts} requires a retry reason`);
  }
  if (previousReceipt?.status !== "failed" || previousReceipt.actual !== null) {
    throw new Error("Retry is allowed only after a transport failure");
  }
}

export function selectAccount(accounts, variant) {
  const eligible = accounts.filter(({ providerId }) => providerId === variant.transport);
  if (eligible.length !== 1) {
    throw new Error(`Expected one ${variant.transport} enrollment, found ${eligible.length}`);
  }
  return eligible[0];
}

export function inspectWireBody(variant, body,
  expectedMaxOutputTokens = executionContract.maxOutputTokens) {
  const observed = variant.transport === "cloud-code"
    ? { model: body.model, effort: body.request?.generationConfig?.thinkingConfig?.thinkingLevel,
      maxOutputTokens: body.request?.generationConfig?.maxOutputTokens }
    : variant.provider === "anthropic"
      ? { model: body.model, effort: body.output_config?.effort ?? null,
        maxOutputTokens: body.max_tokens }
      : { model: body.model, effort: body.reasoning?.effort, maxOutputTokens: body.max_output_tokens };
  const providerEffort = variant.transport === "cloud-code" && variant.effort
    ? variant.effort.toUpperCase() : variant.effort;
  if (observed.model !== variant.model) throw new Error("Observed model differs from frozen request");
  if (variant.effort !== null && observed.effort !== providerEffort) {
    throw new Error("Observed effort differs from frozen request");
  }
  if (observed.maxOutputTokens !== undefined && observed.maxOutputTokens !== expectedMaxOutputTokens) {
    throw new Error("Observed output cap differs from frozen request");
  }
  return { model: observed.model, effort: variant.effort, providerEffort: observed.effort,
    maxOutputTokens: observed.maxOutputTokens ?? null };
}

// Cloud Code answers INVALID_ARGUMENT above 64 000 output tokens on claude-sonnet-4-6
// (measured: 64 000 -> HTTP 200, 64 001 and 65 536 -> HTTP 400), so the v12 Cloud Code
// transport cannot honour the frozen 65 536 cap. The deviation is bounded to that pair.
export const CLOUD_CODE_SONNET_OUTPUT_CAP = 64_000;

export function resolveOutputCap(value, { campaign, documentId, variantName }, frozenCap) {
  if (!value) return frozenCap;
  const cap = Number(value);
  if (campaign === "v12" && variantName === "sonnet-cloudcode"
    && cap === CLOUD_CODE_SONNET_OUTPUT_CAP) return cap;
  if (campaign !== "v5" || documentId !== "valcourt-2026-06-01-agenda"
    || variantName !== "gemini-low" || cap !== 65_536) {
    throw new Error("Output-cap override is restricted to the Valcourt v5 Gemini diagnostic"
      + " and the v12 Cloud Code Sonnet transport cap");
  }
  return cap;
}

export function inspectCloudCodeSse(transcript) {
  let dataEventCount = 0;
  let doneMarker = false;
  let lastData = null;
  for (const line of transcript.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (data === "[DONE]") {
      doneMarker = true;
      continue;
    }
    if (!data) continue;
    try {
      const parsed = JSON.parse(data);
      const payload = parsed.response ?? parsed;
      const finishReason = payload.candidates?.[0]?.finishReason;
      const usage = payload.usageMetadata;
      const usageMetadata = usage && typeof usage === "object" ? Object.fromEntries(
        ["promptTokenCount", "candidatesTokenCount", "thoughtsTokenCount", "totalTokenCount"]
          .filter((key) => typeof usage[key] === "number").map((key) => [key, usage[key]]),
      ) : null;
      dataEventCount += 1;
      lastData = { hasFinishReason: typeof finishReason === "string",
        finishReason: typeof finishReason === "string" ? finishReason : null,
        hasUsageMetadata: usageMetadata !== null, usageMetadata };
    } catch {
      // Mirror llm-mesh: malformed SSE data lines are ignored.
    }
  }
  return { dataEventCount, doneMarker, lastData };
}
