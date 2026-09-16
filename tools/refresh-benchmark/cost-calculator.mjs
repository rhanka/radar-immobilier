#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

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

async function receiptPaths(root) {
  const found = [];
  async function visit(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (/\.attempt-\d+\.receipt\.json$/u.test(entry.name)) found.push(path);
    }
  }
  await visit(root);
  return found.sort();
}

export async function loadReceiptEntries(repositoryRoot, campaign) {
  const resultRoot = join(repositoryRoot, "docs/reviews/refresh-benchmark", campaign);
  const paths = [...await receiptPaths(join(resultRoot, "campaign")),
    ...await receiptPaths(join(resultRoot, "codex-replay/campaign"))];
  return Promise.all(paths.map(async (path) => ({ path,
    receipt: JSON.parse(await readFile(path, "utf8")) })));
}

export function aggregateReceipts(entries) {
  const arms = new Map();
  for (const entry of entries) {
    const receipt = entry.receipt ?? entry;
    if (receipt.schemaVersion !== 2 || typeof receipt.arm !== "string") continue;
    const aggregate = arms.get(receipt.arm) ?? {
      arm: receipt.arm, receiptCount: 0, usageReceiptCount: 0,
      documentIds: new Set(), models: new Set(), transports: new Set(),
      inputTokens: 0, visibleOutputTokens: 0, thinkingTokens: 0,
      outputTokens: 0, totalTokens: 0, actualCostUsd: 0, actualCostSamples: 0,
    };
    aggregate.receiptCount += 1;
    if (receipt.documentId) aggregate.documentIds.add(receipt.documentId);
    const modelId = receipt.requested?.modelId ?? receipt.actual?.modelId ?? receipt.wire?.model;
    if (modelId) aggregate.models.add(canonicalModel(modelId));
    if (receipt.requested?.transportProviderId) {
      aggregate.transports.add(receipt.requested.transportProviderId);
    }
    if (receipt.actual?.usage) {
      const usage = billableUsage(receipt.actual.usage);
      aggregate.usageReceiptCount += 1;
      for (const key of ["inputTokens", "visibleOutputTokens", "thinkingTokens",
        "outputTokens", "totalTokens"]) aggregate[key] += usage[key];
    }
    if (Number.isFinite(receipt.actual?.costUsd)) {
      aggregate.actualCostUsd += receipt.actual.costUsd;
      aggregate.actualCostSamples += 1;
    }
    arms.set(receipt.arm, aggregate);
  }
  return [...arms.values()].sort((a, b) => a.arm.localeCompare(b.arm)).map((value) => {
    const modelIds = [...value.models].sort();
    if (modelIds.length > 1) throw new Error(`Arm ${value.arm} has multiple models: ${modelIds}`);
    const modelId = modelIds[0] ?? null;
    const rate = RATE_CARDS[modelId] ?? null;
    const documents = value.documentIds.size;
    const usage = { inputTokens: value.inputTokens, outputTokens: value.visibleOutputTokens,
      thoughtsTokenCount: value.thinkingTokens };
    return {
      arm: value.arm, modelId, transports: [...value.transports].sort(),
      receiptCount: value.receiptCount, usageReceiptCount: value.usageReceiptCount, documents,
      inputTokens: value.inputTokens, visibleOutputTokens: value.visibleOutputTokens,
      thinkingTokens: value.thinkingTokens, outputTokens: value.outputTokens,
      totalTokens: value.totalTokens,
      perDocument: documents ? { inputTokens: value.inputTokens / documents,
        outputTokens: value.outputTokens / documents, totalTokens: value.totalTokens / documents } : null,
      rate, apiUsd: rate ? apiCost(usage, rate) : null,
      simulated: rate ? simulatedCost(usage, rate) : null,
      actualCostUsd: value.actualCostSamples ? value.actualCostUsd : null,
      actualCostSamples: value.actualCostSamples,
    };
  });
}

export function regressObservedRates(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const receipt = entry.receipt ?? entry;
    if (!receipt.actual?.usage || !Number.isFinite(receipt.actual?.costUsd)) continue;
    const modelId = canonicalModel(receipt.requested?.modelId ?? receipt.actual?.modelId);
    const usage = billableUsage(receipt.actual.usage);
    const group = groups.get(modelId) ?? { modelId, samples: 0, xx: 0, xy: 0, yy: 0, xc: 0, yc: 0 };
    const costPerMillion = receipt.actual.costUsd * 1_000_000;
    group.samples += 1;
    group.xx += usage.inputTokens ** 2;
    group.xy += usage.inputTokens * usage.outputTokens;
    group.yy += usage.outputTokens ** 2;
    group.xc += usage.inputTokens * costPerMillion;
    group.yc += usage.outputTokens * costPerMillion;
    groups.set(modelId, group);
  }
  return [...groups.values()].sort((a, b) => a.modelId.localeCompare(b.modelId)).map((group) => {
    const determinant = group.xx * group.yy - group.xy ** 2;
    if (!determinant) return { modelId: group.modelId, samples: group.samples,
      inputUsdPerMillion: null, outputUsdPerMillion: null };
    return { modelId: group.modelId, samples: group.samples,
      inputUsdPerMillion: (group.xc * group.yy - group.yc * group.xy) / determinant,
      outputUsdPerMillion: (group.yc * group.xx - group.xc * group.xy) / determinant };
  });
}

function rangedSubscription(totalTokens, plan, reserveRange, basis) {
  const [reserveMin, reserveMax] = reserveRange;
  const low = subscriptionCost(totalTokens, plan.monthlyUsd, reserveMax);
  const high = subscriptionCost(totalTokens, plan.monthlyUsd, reserveMin);
  return { basis, weeklyReserveTokens: { min: reserveMin, max: reserveMax },
    usd: { min: low.usd, max: high.usd },
    usdPerToken: { min: low.usdPerToken, max: high.usdPerToken } };
}

export function subscriptionForArm(arm, options = {}) {
  const isGemini = arm.modelId === "gemini-3.8-flash" && arm.transports.includes("cloud-code");
  const isChatgpt = arm.transports.includes("codex")
    && Object.hasOwn(CHATGPT_PLUS_WEEKLY_MESSAGES, arm.modelId);
  const provider = isGemini ? "gemini" : isChatgpt ? "chatgpt" : null;
  if (!provider) return null;
  const planName = options[`${provider}Plan`] ?? null;
  if (!planName) return { provider, plan: null, status: "N-A", reason: "plan-source-gap" };
  const plan = SUBSCRIPTION_PLANS[provider][planName];
  if (!plan) throw new Error(`Unknown ${provider} plan: ${planName}`);
  const override = options[`${provider}WeeklyTokens`] ?? null;
  if (override) return { provider, plan: planName, status: "estimated",
    ...rangedSubscription(arm.totalTokens, plan, [override, override], "weekly-token-override") };
  if (provider === "gemini") return { provider, plan: planName, status: "N-A",
    reason: "weekly-token-reserve-source-gap" };
  const meanTokens = arm.usageReceiptCount ? arm.totalTokens / arm.usageReceiptCount : 0;
  const reserve = chatgptReserveRange(arm.modelId, planName, meanTokens);
  return reserve ? { provider, plan: planName, status: "estimated",
    ...rangedSubscription(arm.totalTokens, plan, reserve, "published-messages-x-observed-tokens") }
    : { provider, plan: planName, status: "N-A", reason: "published-limit-source-gap" };
}

function scaleRange(range, factor) {
  if (!range) return null;
  return { min: range.min * factor, max: range.max * factor };
}

export function buildReport(entries, options = {}) {
  const cycleDocuments = options.cycleDocuments ?? null;
  const arms = aggregateReceipts(entries).map((arm) => {
    const factor1000 = arm.documents ? 1000 / arm.documents : null;
    const factorCycle = arm.documents && cycleDocuments ? cycleDocuments / arm.documents : null;
    const subscription = subscriptionForArm(arm, options);
    return { ...arm, subscription,
      per1000Documents: factor1000 === null ? null : {
        apiUsd: arm.apiUsd === null ? null : arm.apiUsd * factor1000,
        subscriptionUsd: scaleRange(subscription?.usd, factor1000),
        simulatedUsd: arm.simulated ? arm.simulated.usd * factor1000 : null,
      },
      perBenchmarkCycle: factorCycle === null ? null : {
        documents: cycleDocuments,
        apiUsd: arm.apiUsd === null ? null : arm.apiUsd * factorCycle,
        subscriptionUsd: scaleRange(subscription?.usd, factorCycle),
        simulatedUsd: arm.simulated ? arm.simulated.usd * factorCycle : null,
      } };
  });
  return {
    schemaVersion: 1, campaign: options.campaign ?? null,
    generatedAt: new Date().toISOString(),
    selections: { geminiPlan: options.geminiPlan ?? null,
      chatgptPlan: options.chatgptPlan ?? null,
      geminiWeeklyTokens: options.geminiWeeklyTokens ?? null,
      chatgptWeeklyTokens: options.chatgptWeeklyTokens ?? null },
    cycle: { benchmarkDocuments: cycleDocuments, refreshDocuments: null,
      refreshStatus: "source-gap" },
    burn: { status: "N-A", quotaBurnPercent: 0, requests: 0,
      reason: "No measurable pre/post Cloud Code quota observable; 429 exhaustion needs owner GO." },
    verifiedDiscrepancies: [
      { modelId: "gpt-5.6-sol", supplied: { input: 5, output: 30 },
        verified: { input: 4, output: 20 }, note: "Official promotional standard rate." },
      { modelId: "mistral-small-4", supplied: { input: 0.2, output: 0.4 },
        verified: { input: 0.15, output: 0.6 }, note: "Receipt regression and official card agree." },
    ],
    regressions: regressObservedRates(entries), arms,
  };
}

const count = (value, digits = 0) => Number(value).toLocaleString("en-US", {
  minimumFractionDigits: digits, maximumFractionDigits: digits });
const money = (value) => value === null || value === undefined ? "N-A"
  : `$${value.toFixed(Math.abs(value) < 1 ? 4 : 2)}`;
const moneyRange = (range) => !range ? "N-A"
  : Math.abs(range.max - range.min) < 1e-12 ? money(range.min)
    : `${money(range.min)}–${money(range.max)}`;
const tokenPair = (total, perDocument) => `${count(total)} / ${count(perDocument, 0)}`;

export function renderMarkdown(report) {
  const planGemini = report.selections.geminiPlan ?? "N-A (owner tier source-gap)";
  const planChatgpt = report.selections.chatgptPlan ?? "N-A (owner tier source-gap)";
  const lines = [
    `# ${report.campaign} cost snapshot`, "",
    `Generated: ${report.generatedAt}. Every schema-v2 attempt receipt present under \`campaign/\` and `
      + "`codex-replay/campaign/` is counted; retries are not discarded.", "",
    `Selected Gemini plan: **${planGemini}**. Selected ChatGPT plan: **${planChatgpt}**.`,
    "The owner must provide both actual tiers; Gemini also needs a measured or estimated weekly token reserve.", "",
    "## Per-arm costs", "",
    "Output is billable output: visible output plus separately reported thinking tokens. Token columns are total / per document.", "",
    "| Arm | Receipts (usage) | Docs | Input total / doc | Output total / doc | Thinking | API USD | Subscription USD | Simulated USD | API / 1,000 docs | Subscription / 1,000 docs | Simulated / 1,000 docs | API / benchmark cycle |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const arm of report.arms) {
    lines.push(`| ${arm.arm} | ${count(arm.receiptCount)} (${count(arm.usageReceiptCount)}) | ${count(arm.documents)} | `
      + `${tokenPair(arm.inputTokens, arm.perDocument?.inputTokens ?? 0)} | `
      + `${tokenPair(arm.outputTokens, arm.perDocument?.outputTokens ?? 0)} | ${count(arm.thinkingTokens)} | `
      + `${money(arm.apiUsd)} | ${moneyRange(arm.subscription?.usd)} | ${money(arm.simulated?.usd)} | `
      + `${money(arm.per1000Documents?.apiUsd)} | ${moneyRange(arm.per1000Documents?.subscriptionUsd)} | `
      + `${money(arm.per1000Documents?.simulatedUsd)} | ${money(arm.perBenchmarkCycle?.apiUsd)} |`);
  }
  lines.push("", "The benchmark-cycle projection uses the frozen manifest's "
    + `${count(report.cycle.benchmarkDocuments)} documents. Production refresh cycle = **source-gap**: `
    + "the CronJobs define schedules but no stable document count per run.", "",
  "## Modes", "",
  "- `api`: measured input × input rate + (visible output + thinking) × output rate.",
  "- `subscription`: monthly plan price ÷ estimated monthly token reserve. ChatGPT estimates use the official weekly message range multiplied by measured tokens per usage-bearing request. A CLI weekly-token override replaces that estimate.",
  "- `simulated`: measured input/output token shares × the same model's API rates, producing a blended USD/M token rate. It is algebraically equal to API cost and is kept explicit for scenario work.", "",
  "## Hard-coded rate cards", "",
  "| Model | Input USD/M | Output USD/M | As of | Valid until | Source |", "|---|---:|---:|---|---|---|" );
  for (const [modelId, rate] of Object.entries(RATE_CARDS)) {
    lines.push(`| ${modelId} | ${rate.input} | ${rate.output} | ${rate.asOf} | `
      + `${rate.validUntil ?? "—"} | [official pricing](${rate.source}) |`);
  }
  lines.push("", "Gemini output pricing includes thinking tokens; its cache-read rate is $0.075/M through 2026-12-31. `gpt-6-astra` batch/flex is $5/M input and $25/M output.", "",
    "Official verification changed two supplied assumptions: `gpt-5.6-sol` is currently promotional $4/$20, not $5/$30; Mistral Small 4 is $0.15/$0.60, not $0.20/$0.40.", "",
    "## Receipt-cost regression", "",
    "No-intercept two-variable regression: `actual.costUsd × 1M = inputTokens × a + billableOutputTokens × b`.", "",
    "| Model | Samples | Input USD/M | Output USD/M | Hard-coded input/output |", "|---|---:|---:|---:|---|" );
  for (const value of report.regressions) {
    const card = RATE_CARDS[value.modelId];
    lines.push(`| ${value.modelId} | ${value.samples} | ${count(value.inputUsdPerMillion, 6)} | `
      + `${count(value.outputUsdPerMillion, 6)} | ${card ? `${card.input} / ${card.output}` : "N-A"} |`);
  }
  lines.push("", "## Gemini quota experiment", "",
    "**N-A; quota burn = 0%.** llm-mesh 0.19.3 has a generic `quota` outcome type but the Cloud Code transport never populates it. It only reads `Retry-After` after HTTP 429. Successful v101b receipts expose no rate headers; the recorded Cloud Code 429 also has empty headers and no reset.", "",
    "Without a numeric before/after observable, burning requests cannot estimate tokens per quota unit or weekly reserve. The alternative is exhaustion to HTTP 429, which is not authorized without explicit owner GO. No request was sent and no receipt was written under `burn/`.", "",
    "Consequently Gemini tokens/week and equivalent USD/token are N-A. ChatGPT equivalents are also N-A in this snapshot until the owner supplies `--plan-chatgpt`; no Codex burn was performed while its queues were active.", "");
  return `${lines.join("\n")}\n`;
}
