import { executionContract } from "./integration-contract.mjs";

export const variants = Object.freeze({
  "luna-low": { provider: "openai", transport: "codex", model: "gpt-5.6-luna", effort: "low" },
  // Wire ID announced by fetchAvailableModels; replace with llm-mesh 0.19.2 mapping.
  "gemini-low": { provider: "gemini", transport: "cloud-code", model: "gemini-3.8-flash-tiered", effort: "low" },
});

export function createAdapterSet(constructors, observedFetch) {
  const { CloudCodeRuntimeClient, CodexRuntimeClient, GeminiAdapter, OpenAIAdapter,
    getModelProfile } = constructors;
  const baseGemini = getModelProfile("gemini", "gemini-3.8-flash");
  if (!baseGemini) throw new Error("Gemini 3.8 base profile is unavailable");
  return Object.freeze({
    gemini: new GeminiAdapter({ client: new CloudCodeRuntimeClient(observedFetch),
      models: [{ ...baseGemini, modelId: variants["gemini-low"].model }] }),
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
  const observed = variant.provider === "gemini"
    ? { model: body.model, effort: body.request?.generationConfig?.thinkingConfig?.thinkingLevel,
      maxOutputTokens: body.request?.generationConfig?.maxOutputTokens }
    : { model: body.model, effort: body.reasoning?.effort, maxOutputTokens: body.max_output_tokens };
  const providerEffort = variant.provider === "gemini" ? variant.effort.toUpperCase() : variant.effort;
  if (observed.model !== variant.model) throw new Error("Observed model differs from frozen request");
  if (observed.effort !== providerEffort) throw new Error("Observed effort differs from frozen request");
  if (observed.maxOutputTokens !== undefined && observed.maxOutputTokens !== expectedMaxOutputTokens) {
    throw new Error("Observed output cap differs from frozen request");
  }
  return { model: observed.model, effort: variant.effort, providerEffort: observed.effort,
    maxOutputTokens: observed.maxOutputTokens ?? null };
}
