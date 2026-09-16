const codexEfforts = ["low", "medium", "high", "xhigh"];
export const OUTPUT_CAP = 32_768;
export const CODEX_CAP_REASON = "Codex ChatGPT rejects max_output_tokens; the runner omits it.";

const entries = [
  ...["low", "medium", "high"].map((effort) =>
    [`gemini-${effort}`, { lane: "cloud", transport: "cloud-code",
      provider: "gemini", model: "gemini-3.8-flash", effort }]),
  ...codexEfforts.map((effort) =>
    [`luna-${effort}`, { lane: "codex", transport: "codex",
      provider: "openai", model: "gpt-5.6-luna", effort, capEnforced: false }]),
  ["gpt41", { lane: "openai", transport: "openai-api",
    provider: "openai", model: "gpt-4.1", effort: null, prices: [2, 8] }],
  ...["off", "low", "high"].map((effort) =>
    [`sonnet46-cloud-${effort}`, { lane: "cloud", transport: "cloud-code",
      provider: "anthropic", model: "claude-sonnet-4-6",
      effort: effort === "off" ? null : effort }]),
  ...["off", "low", "high"].map((effort) =>
    [`sonnet5-${effort}`, { lane: "anthropic", transport: "anthropic-api",
      provider: "anthropic", model: "claude-sonnet-5",
      effort: effort === "off" ? null : effort, prices: [2, 10] }]),
  ...["off", "low", "high"].map((effort) =>
    [`opus5-${effort}`, { lane: "anthropic", transport: "anthropic-api",
      provider: "anthropic", model: "claude-opus-5",
      effort: effort === "off" ? null : effort, prices: [5, 25] }]),
  ...codexEfforts.map((effort) =>
    [`sol-${effort}`, { lane: "codex", transport: "codex",
      provider: "openai", model: "gpt-5.6-sol", effort, capEnforced: false }]),
  ...codexEfforts.map((effort) =>
    [`astra-${effort}`, { lane: "codex", transport: "codex",
      provider: "openai", model: "gpt-6-astra", effort, capEnforced: false }]),
  ["mistral-small4", { lane: "mistral", transport: "mistral-api",
    provider: "mistral", model: "mistral-small-2603", effort: null, prices: [0.15, 0.60] }],
];

export const arms = Object.freeze(Object.fromEntries(entries.map(([name, arm]) =>
  [name, Object.freeze({ name, ...arm })])));

export const laneArms = Object.freeze(Object.fromEntries(
  ["cloud", "codex", "openai", "anthropic", "mistral"].map((lane) =>
    [lane, Object.freeze(entries.filter(([, arm]) => arm.lane === lane).map(([name]) => name))]),
));

export function usageCostUsd(arm, usage) {
  if (!arm.prices || !usage) return null;
  const input = usage.inputTokens ?? usage.input_tokens;
  const output = usage.outputTokens ?? usage.output_tokens;
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return Number(((input * arm.prices[0] + output * arm.prices[1]) / 1_000_000).toFixed(8));
}

export function receiptCap(arm, usage) {
  const outputTokens = usage?.outputTokens ?? usage?.output_tokens;
  const observedOutputTokens = Number.isFinite(outputTokens) ? outputTokens : null;
  return { requested: OUTPUT_CAP, enforced: arm.capEnforced !== false,
    reason: arm.capEnforced === false ? CODEX_CAP_REASON : null,
    observedOutputTokens,
    classification: observedOutputTokens === null ? "unmeasured"
      : observedOutputTokens > OUTPUT_CAP ? "out-of-cap" : "within-observed-cap" };
}
