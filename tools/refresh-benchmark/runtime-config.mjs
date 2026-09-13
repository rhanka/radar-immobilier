export const variants = Object.freeze({
  "luna-low": { provider: "openai", transport: "codex", model: "gpt-5.6-luna", effort: "low" },
  "gemini-low": { provider: "gemini", transport: "cloud-code", model: "gemini-3.8-flash", effort: "low" },
});

export function selectAccount(accounts, variant) {
  const eligible = accounts.filter(({ providerId }) => providerId === variant.transport);
  if (eligible.length !== 1) {
    throw new Error(`Expected one ${variant.transport} enrollment, found ${eligible.length}`);
  }
  return eligible[0];
}

export function inspectWireBody(variant, body, expectedMaxOutputTokens = 16384) {
  const observed = variant.provider === "gemini"
    ? { model: body.model, effort: body.request?.generationConfig?.thinkingConfig?.thinkingLevel,
      maxOutputTokens: body.request?.generationConfig?.maxOutputTokens }
    : { model: body.model, effort: body.reasoning?.effort, maxOutputTokens: body.max_output_tokens };
  const providerEffort = variant.provider === "gemini" ? variant.effort.toUpperCase() : variant.effort;
  if (observed.model !== variant.model) throw new Error("Observed model differs from frozen request");
  if (observed.effort !== providerEffort) throw new Error("Observed effort differs from frozen request");
  if (observed.maxOutputTokens !== expectedMaxOutputTokens) {
    throw new Error("Observed output cap differs from frozen request");
  }
  return { model: observed.model, effort: variant.effort, providerEffort: observed.effort,
    maxOutputTokens: observed.maxOutputTokens };
}
