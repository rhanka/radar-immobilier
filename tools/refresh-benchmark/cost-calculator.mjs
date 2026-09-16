#!/usr/bin/env node

// Prices are USD per million tokens. `output` includes provider-reported thinking tokens.
export const RATE_CARDS = Object.freeze({
  "gemini-3.8-flash": {
    input: 0.75, output: 3.75, cacheRead: 0.075,
    postPromo: { input: 1.5, output: 7.5, cacheRead: 0.15 },
    asOf: "2026-09-16", validUntil: "2026-12-31",
    source: "https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash",
  },
  "claude-sonnet-5": {
    input: 2, output: 10, asOf: "2026-09-16",
    source: "https://platform.claude.com/docs/en/about-claude/pricing",
  },
  "claude-opus-5": {
    input: 5, output: 25, asOf: "2026-09-16",
    source: "https://platform.claude.com/docs/en/about-claude/pricing",
  },
  "claude-sonnet-4.6": {
    input: 3, output: 15, asOf: "2026-09-16",
    source: "https://platform.claude.com/docs/en/about-claude/pricing",
  },
  "gpt-4.1": {
    input: 2, output: 8, asOf: "2026-09-16",
    source: "https://developers.openai.com/api/docs/pricing",
  },
  "mistral-small-4": {
    input: 0.15, output: 0.6, asOf: "2026-09-16",
    source: "https://docs.mistral.ai/models/model-cards/mistral-small-4-0-26-03",
  },
  "gpt-5.6-sol": {
    input: 4, output: 20, asOf: "2026-09-16", validUntil: "2026-11-21",
    source: "https://developers.openai.com/api/docs/pricing",
  },
  "gpt-5.6-terra": {
    input: 2, output: 12, asOf: "2026-09-16",
    source: "https://developers.openai.com/api/docs/pricing",
  },
  "gpt-5.6-luna": {
    input: 0.2, output: 1.2, asOf: "2026-09-16",
    source: "https://developers.openai.com/api/docs/pricing",
  },
  "gpt-6-astra": {
    input: 10, output: 50, batchInput: 5, batchOutput: 25,
    asOf: "2026-09-16",
    source: "https://developers.openai.com/api/docs/pricing",
  },
});

const CHATGPT_SOURCE = "https://learn.chatgpt.com/docs/pricing";
const GOOGLE_SOURCE = "https://gemini.google/subscriptions/";
export const SUBSCRIPTION_PLANS = Object.freeze({
  chatgpt: {
    plus: { monthlyUsd: 20, limitMultiplier: 1, asOf: "2026-09-16", source: CHATGPT_SOURCE },
    "pro-5x": { monthlyUsd: 100, limitMultiplier: 5, asOf: "2026-09-16", source: CHATGPT_SOURCE },
    "pro-20x": { monthlyUsd: 200, limitMultiplier: 20, asOf: "2026-09-16", source: CHATGPT_SOURCE },
  },
  gemini: {
    "ai-pro": { monthlyUsd: 19.99, asOf: "2026-09-16", source: GOOGLE_SOURCE },
    "ai-ultra-5x": { monthlyUsd: 99.99, asOf: "2026-09-16", source: GOOGLE_SOURCE },
    "ai-ultra-20x": { monthlyUsd: 199.99, asOf: "2026-09-16", source: GOOGLE_SOURCE },
  },
});

// Official Codex page: estimated messages/week on Plus; Pro tiers multiply these bounds.
export const CHATGPT_PLUS_WEEKLY_MESSAGES = Object.freeze({
  "gpt-6-astra": [5, 45],
  "gpt-5.6-sol": [10, 100],
  "gpt-5.6-terra": [25, 200],
  "gpt-5.6-luna": [250, 2000],
});

const MODEL_ALIASES = Object.freeze({
  "gemini-3.8-flash-tiered": "gemini-3.8-flash",
  "claude-sonnet-4-6": "claude-sonnet-4.6",
  "mistral-small-2603": "mistral-small-4",
});
export const WEEKS_PER_MONTH = 52 / 12;

export function canonicalModel(modelId) {
  return MODEL_ALIASES[modelId] ?? modelId;
}

export function billableUsage(usage = {}) {
  const inputTokens = Number(usage.inputTokens ?? 0);
  const visibleOutputTokens = Number(usage.outputTokens ?? 0);
  const thinkingTokens = Number(usage.thoughtsTokenCount ?? usage.reasoningTokens ?? 0);
  for (const value of [inputTokens, visibleOutputTokens, thinkingTokens]) {
    if (!Number.isFinite(value) || value < 0) throw new Error("Usage tokens must be non-negative numbers");
  }
  return { inputTokens, visibleOutputTokens, thinkingTokens,
    outputTokens: visibleOutputTokens + thinkingTokens,
    totalTokens: inputTokens + visibleOutputTokens + thinkingTokens };
}

export function apiCost(usage, rate) {
  const value = billableUsage(usage);
  return (value.inputTokens * rate.input + value.outputTokens * rate.output) / 1_000_000;
}

export function simulatedCost(usage, rate) {
  const value = billableUsage(usage);
  if (value.totalTokens === 0) return { usd: 0, blendedUsdPerMillion: 0 };
  const blendedUsdPerMillion = (value.inputTokens * rate.input
    + value.outputTokens * rate.output) / value.totalTokens;
  return { usd: value.totalTokens * blendedUsdPerMillion / 1_000_000,
    blendedUsdPerMillion };
}

export function subscriptionCost(totalTokens, monthlyUsd, weeklyReserveTokens) {
  if (!(weeklyReserveTokens > 0)) return null;
  const usdPerToken = monthlyUsd / (weeklyReserveTokens * WEEKS_PER_MONTH);
  return { usd: totalTokens * usdPerToken, usdPerToken, weeklyReserveTokens };
}

export function chatgptReserveRange(modelId, planName, meanTokensPerRequest) {
  const bounds = CHATGPT_PLUS_WEEKLY_MESSAGES[canonicalModel(modelId)];
  const plan = SUBSCRIPTION_PLANS.chatgpt[planName];
  if (!bounds || !plan || !(meanTokensPerRequest > 0)) return null;
  return bounds.map((messages) => messages * plan.limitMultiplier * meanTokensPerRequest);
}
