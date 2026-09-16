#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const CHATGPT_SOURCE = "https://developers.openai.com/codex/pricing";
const GOOGLE_SOURCE = "https://gemini.google/subscriptions/";
const CLAUDE_SOURCE = "https://www.anthropic.com/pricing";
export const SUBSCRIPTION_PLANS = Object.freeze({
  chatgpt: {
    plus: { monthlyUsd: 20, limitMultiplier: 1, asOf: "2026-09-16", source: CHATGPT_SOURCE },
    "pro-5x": { monthlyUsd: 100, limitMultiplier: 5, asOf: "2026-09-16", source: CHATGPT_SOURCE },
    "pro-20x": { monthlyUsd: 200, limitMultiplier: 20, asOf: "2026-09-16", source: CHATGPT_SOURCE },
  },
  gemini: {
    "ai-pro": { monthlyUsd: 19.99, limitMultiplier: 1, asOf: "2026-09-16", source: GOOGLE_SOURCE },
    "ai-ultra-5x": { monthlyUsd: 99.99, limitMultiplier: 5, asOf: "2026-09-16", source: GOOGLE_SOURCE },
    "ai-ultra-20x": { monthlyUsd: 199.99, limitMultiplier: 20, asOf: "2026-09-16", source: GOOGLE_SOURCE },
  },
  claude: {
    pro: { monthlyUsd: 20, limitMultiplier: 1, asOf: "2026-09-16", source: CLAUDE_SOURCE },
    "max-5x": { monthlyUsd: 100, limitMultiplier: 5, asOf: "2026-09-16", source: CLAUDE_SOURCE },
    "max-20x": { monthlyUsd: 200, limitMultiplier: 20, asOf: "2026-09-16", source: CLAUDE_SOURCE },
  },
});

// Official Codex page: estimated local messages per five-hour period, never a weekly reserve.
export const CHATGPT_PLUS_FIVE_HOUR_MESSAGES = Object.freeze({
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
      documentIds: new Set(), usageDocumentIds: new Set(), acceptedDocumentIds: new Set(),
      models: new Set(), transports: new Set(),
      inputTokens: 0, visibleOutputTokens: 0, thinkingTokens: 0,
      outputTokens: 0, totalTokens: 0, actualCostUsd: 0, actualCostSamples: 0,
    };
    aggregate.receiptCount += 1;
    if (receipt.documentId) aggregate.documentIds.add(receipt.documentId);
    if (receipt.documentId && receipt.validation?.accepted === true) {
      aggregate.acceptedDocumentIds.add(receipt.documentId);
    }
    const modelId = receipt.requested?.modelId ?? receipt.actual?.modelId ?? receipt.wire?.model;
    if (modelId) aggregate.models.add(canonicalModel(modelId));
    if (receipt.requested?.transportProviderId) {
      aggregate.transports.add(receipt.requested.transportProviderId);
    }
    if (receipt.actual?.usage) {
      const usage = billableUsage(receipt.actual.usage);
      aggregate.usageReceiptCount += 1;
      if (receipt.documentId) aggregate.usageDocumentIds.add(receipt.documentId);
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
    const documents = value.usageDocumentIds.size;
    const usage = { inputTokens: value.inputTokens, outputTokens: value.visibleOutputTokens,
      thoughtsTokenCount: value.thinkingTokens };
    return {
      arm: value.arm, modelId, transports: [...value.transports].sort(),
      receiptCount: value.receiptCount, usageReceiptCount: value.usageReceiptCount,
      documents, attemptedDocuments: value.documentIds.size,
      acceptedDocuments: value.acceptedDocumentIds.size,
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
    && Object.hasOwn(CHATGPT_PLUS_FIVE_HOUR_MESSAGES, arm.modelId);
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
  return { provider, plan: planName, status: "N-A", reason: "weekly-token-reserve-source-gap" };
}

const SEAT_ARMS = Object.freeze({
  "gemini-low": { provider: "gemini" },
  "sol-medium": { provider: "chatgpt" },
  "luna-high": { provider: "chatgpt" },
  "sonnet46-cloud-off": { provider: "claude" },
});
const OBSERVATION_FIELDS = new Set(["arm", "provider", "status", "reason", "method",
  "sourceStatus", "basePlan", "windowMinutes", "usedPercent", "campaignTokens",
  "quotaDeltaPercent", "documents", "tokens"]);
const N_A_REASONS = new Set(["weekly-window-source-gap", "transport-mismatch",
  "plan-source-gap", "missing-observation"]);

export function validateSeatObservations(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.observations)) {
    throw new Error("Seat observations must use schemaVersion 1 and an observations array");
  }
  const seen = new Set();
  for (const observation of value.observations) {
    for (const key of Object.keys(observation)) {
      if (!OBSERVATION_FIELDS.has(key)) throw new Error(`Unknown observation field: ${key}`);
    }
    const config = SEAT_ARMS[observation.arm];
    if (!config || observation.provider !== config.provider) {
      throw new Error(`Invalid seat arm/provider mapping: ${observation.arm}`);
    }
    if (seen.has(observation.arm)) throw new Error(`Duplicate seat observation: ${observation.arm}`);
    seen.add(observation.arm);
    if (observation.status === "N-A") {
      if (!N_A_REASONS.has(observation.reason)) throw new Error(`Invalid N-A reason: ${observation.reason}`);
      continue;
    }
    if (!["measured", "scenario"].includes(observation.status)
      || !["controlled-burn", "account-percent/campaign-token-ratio"].includes(observation.method)
      || observation.sourceStatus !== "observed"
      || !Number.isFinite(observation.windowMinutes) || observation.windowMinutes <= 0) {
      throw new Error(`Invalid capacity observation: ${observation.arm}`);
    }
    const plans = SUBSCRIPTION_PLANS[observation.provider];
    if (observation.basePlan !== null && !plans?.[observation.basePlan]) {
      throw new Error(`Invalid base plan: ${observation.basePlan}`);
    }
    if (observation.method === "account-percent/campaign-token-ratio") {
      if (!(observation.usedPercent > 0 && observation.usedPercent <= 100)
        || !(observation.campaignTokens > 0)) throw new Error(`Invalid ratio data: ${observation.arm}`);
    } else if (!(observation.quotaDeltaPercent > 0 && observation.quotaDeltaPercent <= 10)
      || !(observation.documents > 0) || !(observation.tokens > 0)) {
      throw new Error(`Invalid controlled burn: ${observation.arm}`);
    }
  }
  return value.observations;
}

function observedCapacity(arm, observation) {
  if (!observation) return { status: "N-A", reason: "missing-observation" };
  if (observation.status === "N-A") return { status: "N-A", reason: observation.reason };
  if (observation.windowMinutes !== 10_080) return { status: "N-A", reason: "non-weekly-window" };
  const tokensPerDocument = arm.documents ? arm.totalTokens / arm.documents : 0;
  if (!(tokensPerDocument > 0)) return { status: "N-A", reason: "missing-usage" };
  const quotaFraction = (observation.method === "controlled-burn"
    ? observation.quotaDeltaPercent : observation.usedPercent) / 100;
  const docsPerWeek = observation.method === "controlled-burn"
    ? observation.documents / quotaFraction
    : observation.campaignTokens / quotaFraction / tokensPerDocument;
  const tokensPerWeek = observation.method === "controlled-burn"
    ? observation.tokens / quotaFraction : observation.campaignTokens / quotaFraction;
  return { status: observation.status, method: observation.method,
    docsPerTenPercent: docsPerWeek / 10, docsPerWeek,
    docsPerMonth: docsPerWeek * WEEKS_PER_MONTH, tokensPerWeek };
}

export function buildSeatComparisons(arms, observations = []) {
  const byArm = new Map(observations.map((value) => [value.arm, value]));
  const selected = arms.filter(({ arm }) => SEAT_ARMS[arm]).map((arm) => {
    const observation = byArm.get(arm.arm);
    const observed = observedCapacity(arm, observation);
    const acceptedRate = arm.attemptedDocuments ? arm.acceptedDocuments / arm.attemptedDocuments : null;
    const apiUsdPerDocument = arm.documents && arm.apiUsd !== null ? arm.apiUsd / arm.documents : null;
    return { arm: arm.arm, provider: SEAT_ARMS[arm.arm].provider,
      status: observed.status, reason: observed.reason ?? null, observed,
      acceptedRate, apiUsdPerDocument,
      apiUsdPerAccepted: acceptedRate > 0 ? apiUsdPerDocument / acceptedRate : null };
  });
  const rows = [];
  for (const arm of selected) {
    const observation = byArm.get(arm.arm);
    for (const [plan, details] of Object.entries(SUBSCRIPTION_PLANS[arm.provider])) {
      const base = observation?.basePlan ? SUBSCRIPTION_PLANS[arm.provider][observation.basePlan] : null;
      const scale = arm.observed.status === "N-A" ? null
        : base ? details.limitMultiplier / base.limitMultiplier : 1;
      const docsPerMonth = scale === null ? null : arm.observed.docsPerMonth * scale;
      const breakEvenDocuments = arm.apiUsdPerDocument === null
        ? null : Math.floor(details.monthlyUsd / arm.apiUsdPerDocument) + 1;
      rows.push({ arm: arm.arm, provider: arm.provider, plan,
        monthlyUsd: details.monthlyUsd,
        capacityBasis: scale === null ? "N-A"
          : base ? "scaled-from-base-plan" : "conditional-plan-is-observed-tier",
        docsPerWeek: scale === null ? null : arm.observed.docsPerWeek * scale,
        docsPerMonth,
        acceptedDocsPerMonth: docsPerMonth === null || arm.acceptedRate === null
          ? null : docsPerMonth * arm.acceptedRate,
        seatUsdPerDocument: docsPerMonth ? details.monthlyUsd / docsPerMonth : null,
        breakEvenDocuments,
        breakEvenReachable: docsPerMonth === null || breakEvenDocuments === null
          ? null : breakEvenDocuments <= docsPerMonth,
        seatsFor1000Documents: docsPerMonth ? Math.ceil(1000 / docsPerMonth) : null,
        seatUsdFor1000Documents: docsPerMonth
          ? Math.ceil(1000 / docsPerMonth) * details.monthlyUsd : null,
        apiUsdFor1000Documents: arm.apiUsdPerDocument === null
          ? null : arm.apiUsdPerDocument * 1000,
      });
    }
  }
  return { arms: selected, rows };
}

function scaleRange(range, factor) {
  if (!range) return null;
  return { min: range.min * factor, max: range.max * factor };
}

export function buildReport(entries, options = {}) {
  const cycleDocuments = options.cycleDocuments ?? null;
  const aggregateArms = aggregateReceipts(entries);
  const arms = aggregateArms.map((arm) => {
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
    rateCards: RATE_CARDS, subscriptionPlans: SUBSCRIPTION_PLANS,
    chatgptPlusFiveHourMessages: CHATGPT_PLUS_FIVE_HOUR_MESSAGES,
    seatComparison: buildSeatComparisons(aggregateArms,
      Array.isArray(options.seatObservations) ? options.seatObservations : []),
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
    "| Arm | Receipts (usage) | Docs usage / attempted / accepted | Input total / doc | Visible output total / doc | Thinking | Billable output | API USD | Subscription USD | Simulated USD | API / 1,000 docs | Subscription / 1,000 docs | Simulated / 1,000 docs | API / benchmark cycle |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const arm of report.arms) {
    lines.push(`| ${arm.arm} | ${count(arm.receiptCount)} (${count(arm.usageReceiptCount)}) | `
      + `${count(arm.documents)} / ${count(arm.attemptedDocuments)} / ${count(arm.acceptedDocuments)} | `
      + `${tokenPair(arm.inputTokens, arm.perDocument?.inputTokens ?? 0)} | `
      + `${tokenPair(arm.visibleOutputTokens, arm.documents ? arm.visibleOutputTokens / arm.documents : 0)} | `
      + `${count(arm.thinkingTokens)} | ${count(arm.outputTokens)} | `
      + `${money(arm.apiUsd)} | ${moneyRange(arm.subscription?.usd)} | ${money(arm.simulated?.usd)} | `
      + `${money(arm.per1000Documents?.apiUsd)} | ${moneyRange(arm.per1000Documents?.subscriptionUsd)} | `
      + `${money(arm.per1000Documents?.simulatedUsd)} | ${money(arm.perBenchmarkCycle?.apiUsd)} |`);
  }
  lines.push("", "The benchmark-cycle projection uses the frozen manifest's "
    + `${count(report.cycle.benchmarkDocuments)} documents. Production refresh cycle = **source-gap**: `
    + "the CronJobs define schedules but no stable document count per run.", "",
  "## Siège vs token", "",
  "Une capacité n'est publiée que pour une fenêtre attestée de 7 jours. `scenario` est le ratio indirect quota compte/tokens campagne; il suppose un quota linéaire en tokens et une pondération Sol/Luna identique, toutes deux non vérifiées.", "",
  "| Arm | Statut | Rendement accepté | Docs / 10% | Docs / semaine | Docs / mois | Tokens / semaine | API / doc | API / résultat accepté |",
  "|---|---|---:|---:|---:|---:|---:|---:|---:|" );
  for (const arm of report.seatComparison.arms) {
    const capacity = arm.observed.status === "N-A" ? null : arm.observed;
    lines.push(`| ${arm.arm} | ${arm.status}${arm.reason ? ` (${arm.reason})` : ""} | `
      + `${arm.acceptedRate === null ? "N-A" : count(arm.acceptedRate * 100, 1) + "%"} | `
      + `${capacity ? count(capacity.docsPerTenPercent, 1) : "N-A"} | `
      + `${capacity ? count(capacity.docsPerWeek, 1) : "N-A"} | `
      + `${capacity ? count(capacity.docsPerMonth, 1) : "N-A"} | `
      + `${capacity ? count(capacity.tokensPerWeek, 0) : "N-A"} | `
      + `${money(arm.apiUsdPerDocument)} | ${money(arm.apiUsdPerAccepted)} |`);
  }
  lines.push("", "Quand le palier observé 1x/5x/20x est source-gap, chaque ligne est conditionnelle: elle suppose que ce palier est celui du siège observé, sans extrapolation de multiplicateur. Avec `basePlan` renseigné, les autres lignes sont mises à l'échelle. Les seuils économiques ne dépendent que du prix mensuel et du coût API mesuré.", "",
    "| Arm | Palier | Base capacité | USD/mois | Docs/semaine | Docs/mois | Siège/doc | Seuil strict siège < API | Atteignable/siège | Sièges pour 1 000 docs/mois | Siège / 1 000 | API / 1 000 |",
    "|---|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|" );
  for (const row of report.seatComparison.rows) {
    lines.push(`| ${row.arm} | ${row.provider}/${row.plan} | ${row.capacityBasis} | ${money(row.monthlyUsd)} | `
      + `${row.docsPerWeek === null ? "N-A" : count(row.docsPerWeek, 1)} | `
      + `${row.docsPerMonth === null ? "N-A" : count(row.docsPerMonth, 1)} | `
      + `${money(row.seatUsdPerDocument)} | ${count(row.breakEvenDocuments)} | `
      + `${row.breakEvenReachable === null ? "N-A" : row.breakEvenReachable ? "oui" : "non"} | `
      + `${row.seatsFor1000Documents ?? "N-A"} | ${money(row.seatUsdFor1000Documents)} | `
      + `${money(row.apiUsdFor1000Documents)} |`);
  }
  lines.push("", "Cycle de production: **N-A (source-gap)**. Le manifeste de 100 documents est un cycle benchmark, pas un volume de refresh. Pour un cycle de `N` documents, le coût API est `N × API/doc`; le coût siège requiert d'abord une capacité mensuelle attestée.", "",
  "## Modes", "",
  "- `api`: measured input × input rate + (visible output + thinking) × output rate.",
  "- `subscription`: monthly plan price ÷ monthly token reserve, uniquement avec un override hebdomadaire explicite; les limites 5 h ne sont jamais extrapolées en semaine.",
  "- `simulated`: measured input/output token shares × the same model's API rates, producing a blended USD/M token rate. It is algebraically equal to API cost and is kept explicit for scenario work.", "",
  "## Hard-coded rate cards", "",
  "| Model | Input USD/M | Output USD/M | As of | Valid until | Source |", "|---|---:|---:|---|---|---|" );
  for (const [modelId, rate] of Object.entries(RATE_CARDS)) {
    lines.push(`| ${modelId} | ${rate.input} | ${rate.output} | ${rate.asOf} | `
      + `${rate.validUntil ?? "—"} | [official pricing](${rate.source}) |`);
  }
  lines.push("", "Gemini output pricing includes thinking tokens; its cache-read rate is $0.075/M through 2026-12-31. `gpt-6-astra` batch/flex is $5/M input and $25/M output.", "",
    "Official verification changed two supplied assumptions: `gpt-5.6-sol` is currently promotional $4/$20, not $5/$30; Mistral Small 4 is $0.15/$0.60, not $0.20/$0.40.", "",
    "## Subscription plan catalog", "",
    "| Provider | Plan | USD/month | As of | Source |", "|---|---|---:|---|---|" );
  for (const [provider, plans] of Object.entries(SUBSCRIPTION_PLANS)) {
    for (const [planName, plan] of Object.entries(plans)) {
      lines.push(`| ${provider} | ${planName} | ${plan.monthlyUsd} | ${plan.asOf} | `
        + `[official plan page](${plan.source}) |`);
    }
  }
  lines.push("", "The official Codex page publishes estimated local-message ranges per five-hour period. They are not weekly capacities. Pro 5x and Pro 20x multiply the Plus bounds:", "",
    "| Model | Plus messages/5h | Pro 5x | Pro 20x |", "|---|---:|---:|---:|" );
  for (const [modelId, bounds] of Object.entries(CHATGPT_PLUS_FIVE_HOUR_MESSAGES)) {
    lines.push(`| ${modelId} | ${bounds[0]}–${count(bounds[1])} | `
      + `${count(bounds[0] * 5)}–${count(bounds[1] * 5)} | `
      + `${count(bounds[0] * 20)}–${count(bounds[1] * 20)} |`);
  }
  lines.push("", "Google publishes the listed USD prices and relative 1x/5x/20x tiers, but no token-denominated weekly reserve. Checkout price and taxes remain region-dependent.", "",
    "## Receipt-cost regression", "",
    "No-intercept two-variable regression: `actual.costUsd × 1M = inputTokens × a + billableOutputTokens × b`.", "",
    "| Model | Samples | Input USD/M | Output USD/M | Hard-coded input/output |", "|---|---:|---:|---:|---|" );
  for (const value of report.regressions) {
    const card = RATE_CARDS[value.modelId];
    lines.push(`| ${value.modelId} | ${value.samples} | ${count(value.inputUsdPerMillion, 6)} | `
      + `${count(value.outputUsdPerMillion, 6)} | ${card ? `${card.input} / ${card.output}` : "N-A"} |`);
  }
  lines.push("", "## Observables de quota", "",
    "- Codex/ChatGPT: `wham/usage` expose le pourcentage, la durée et le reset de la fenêtre. La capacité Sol/Luna ci-dessus est un scénario par ratio avec les reçus de campagne, pas une mesure marginale par bras.",
    "- Google Cloud Code: `loadCodeAssist` expose le palier et `retrieveUserQuota` des buckets par modèle (`remainingFraction`, `resetTime`). llm-mesh 0.19.3 n'appelle pas ce dernier et ne conserve que `Retry-After` après 429. Le bucket Gemini observé dure 5 h; aucune capacité hebdomadaire n'en est extrapolée.",
    "- Claude Code OAuth: `/usage` expose les fenêtres 5 h et 7 j, mais `sonnet46-cloud-off` utilise Google Cloud Code. Une projection Claude Pro/Max pour ce bras serait un changement de transport; elle reste N-A.", "",
    "Burn corpus: **0 requête Gemini, 0 requête Sonnet**. Les deux appels Google étaient des lectures de métadonnées quota. Le plafond de 10 % ne pouvait pas être garanti avant le document suivant; aucun traitement n'a été lancé.", "");
  return lines.join("\n");
}

const GEMINI_PLAN_ALIASES = Object.freeze({
  pro: "ai-pro", "ai-pro": "ai-pro",
  "ultra-5x": "ai-ultra-5x", "ai-ultra-5x": "ai-ultra-5x",
  "ultra-20x": "ai-ultra-20x", "ai-ultra-20x": "ai-ultra-20x",
});

export function parseArgs(argv) {
  const options = { format: "md", campaign: null, geminiPlan: null, chatgptPlan: null,
    geminiWeeklyTokens: null, chatgptWeeklyTokens: null, seatObservations: null };
  const valued = new Set(["--campaign", "--plan-gemini", "--plan-chatgpt", "--format",
    "--gemini-weekly-tokens", "--chatgpt-weekly-tokens", "--seat-observations"]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help") return { ...options, help: true };
    if (!valued.has(flag)) throw new Error(`Unknown argument: ${flag}`);
    const value = argv[index += 1];
    if (!value) throw new Error(`Missing value for ${flag}`);
    if (flag === "--campaign") options.campaign = value;
    else if (flag === "--format") options.format = value;
    else if (flag === "--seat-observations") options.seatObservations = value;
    else if (flag === "--plan-gemini") options.geminiPlan = GEMINI_PLAN_ALIASES[value] ?? value;
    else if (flag === "--plan-chatgpt") options.chatgptPlan = value;
    else {
      const number = Number(value);
      if (!(number > 0)) throw new Error(`${flag} must be a positive number`);
      options[flag === "--gemini-weekly-tokens" ? "geminiWeeklyTokens"
        : "chatgptWeeklyTokens"] = number;
    }
  }
  if (!options.campaign || !/^[A-Za-z0-9._-]+$/u.test(options.campaign)) {
    throw new Error("--campaign is required and must be a safe campaign name");
  }
  if (!new Set(["md", "json"]).has(options.format)) throw new Error("--format must be md or json");
  if (options.geminiPlan && !SUBSCRIPTION_PLANS.gemini[options.geminiPlan]) {
    throw new Error(`Unknown Gemini plan: ${options.geminiPlan}`);
  }
  if (options.chatgptPlan && !SUBSCRIPTION_PLANS.chatgpt[options.chatgptPlan]) {
    throw new Error(`Unknown ChatGPT plan: ${options.chatgptPlan}`);
  }
  return options;
}

export const HELP = `Usage: node cost-calculator.mjs --campaign <name> [options]

Options:
  --plan-gemini pro|ultra-5x|ultra-20x
  --plan-chatgpt plus|pro-5x|pro-20x
  --gemini-weekly-tokens <tokens>    Measured/estimated weekly reserve override
  --chatgpt-weekly-tokens <tokens>   Override published-message estimate
  --seat-observations <json>         Allowlisted quota observations (schema v1)
  --format md|json                   Default: md
`;

async function manifestDocumentCount(repositoryRoot, campaign) {
  const path = join(repositoryRoot, "docs/reviews/refresh-benchmark", campaign, "manifest.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  const value = manifest.corpus?.documentCount ?? (Array.isArray(manifest.documents)
    ? manifest.documents.length : Object.keys(manifest.documents ?? {}).length);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export async function runCli(argv, write = (value) => process.stdout.write(value)) {
  const options = parseArgs(argv);
  if (options.help) { write(HELP); return null; }
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const entries = await loadReceiptEntries(repositoryRoot, options.campaign);
  const cycleDocuments = await manifestDocumentCount(repositoryRoot, options.campaign);
  const seatObservations = options.seatObservations
    ? validateSeatObservations(JSON.parse(await readFile(resolve(options.seatObservations), "utf8"))) : [];
  const report = buildReport(entries, { ...options, cycleDocuments, seatObservations });
  write(options.format === "json" ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report));
  return report;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`cost-calculator: ${error.message}\n`);
    process.exitCode = 1;
  });
}
