import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  RATE_CARDS,
  SUBSCRIPTION_PLANS,
  aggregateReceipts,
  apiCost,
  billableUsage,
  buildSeatComparisons,
  buildReport,
  loadReceiptEntries,
  parseArgs,
  regressObservedRates,
  renderMarkdown,
  simulatedCost,
  subscriptionCost,
  validateSeatObservations,
} from "./cost-calculator.mjs";

const close = (actual, expected, tolerance = 1e-12) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};
const receipt = (overrides = {}) => ({
  schemaVersion: 2,
  arm: "gemini-medium",
  documentId: "synthetic-document",
  requested: { modelId: "gemini-3.8-flash", transportProviderId: "cloud-code" },
  actual: { usage: { inputTokens: 1000, outputTokens: 500, thoughtsTokenCount: 200,
    totalTokens: 1700 }, costUsd: null },
  ...overrides,
});

test("should expose dated, sourced public rates", () => {
  assert.deepEqual(
    [RATE_CARDS["gemini-3.8-flash"].input, RATE_CARDS["gemini-3.8-flash"].output],
    [0.75, 3.75],
  );
  assert.equal(RATE_CARDS["gemini-3.8-flash"].cacheRead, 0.075);
  assert.equal(RATE_CARDS["gemini-3.8-flash"].validUntil, "2026-12-31");
  assert.deepEqual([RATE_CARDS["gpt-5.6-sol"].input, RATE_CARDS["gpt-5.6-sol"].output],
    [4, 20]);
  assert.deepEqual([RATE_CARDS["mistral-small-4"].input,
    RATE_CARDS["mistral-small-4"].output], [0.15, 0.6]);
  for (const rate of Object.values(RATE_CARDS)) {
    assert.match(rate.asOf, /^\d{4}-\d{2}-\d{2}$/u);
    assert.match(rate.source, /^https:\/\//u);
  }
  assert.equal(SUBSCRIPTION_PLANS.chatgpt["pro-20x"].monthlyUsd, 200);
  assert.equal(SUBSCRIPTION_PLANS.gemini["ai-ultra-5x"].monthlyUsd, 99.99);
});

test("should price thinking tokens as output in API and simulated modes", () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 500_000,
    thoughtsTokenCount: 250_000 };
  assert.deepEqual(billableUsage(usage), { inputTokens: 1_000_000,
    visibleOutputTokens: 500_000, thinkingTokens: 250_000, outputTokens: 750_000,
    totalTokens: 1_750_000 });
  const api = apiCost(usage, RATE_CARDS["gemini-3.8-flash"]);
  close(api, 3.5625);
  const simulated = simulatedCost(usage, RATE_CARDS["gemini-3.8-flash"]);
  close(simulated.usd, api);
  close(simulated.blendedUsdPerMillion, api / 1.75);
});

test("should calculate a subscription equivalent only from explicit weekly tokens", () => {
  const result = subscriptionCost(2_000_000, 20, 1_000_000);
  close(result.usdPerToken, 20 / (1_000_000 * 52 / 12));
  close(result.usd, 40 / (52 / 12));
});

test("should aggregate one synthetic schema-v2 receipt", () => {
  const [arm] = aggregateReceipts([receipt()]);
  assert.equal(arm.receiptCount, 1);
  assert.equal(arm.usageReceiptCount, 1);
  assert.equal(arm.documents, 1);
  assert.equal(arm.attemptedDocuments, 1);
  assert.equal(arm.thinkingTokens, 200);
  assert.equal(arm.outputTokens, 700);
  assert.equal(arm.totalTokens, 1700);
  assert.equal(arm.acceptedDocuments, 0);
  close(arm.apiUsd, (1000 * 0.75 + 700 * 3.75) / 1_000_000);
});

test("should project a weekly seat observation and fixed 1000-document cost", () => {
  const arm = { arm: "sol-medium", documents: 10, attemptedDocuments: 10,
    acceptedDocuments: 8, totalTokens: 10_000, apiUsd: 2 };
  const observations = validateSeatObservations({ schemaVersion: 1, observations: [{
    arm: "sol-medium", provider: "chatgpt", status: "scenario",
    method: "account-percent/campaign-token-ratio", sourceStatus: "observed",
    basePlan: "plus", windowMinutes: 10_080, usedPercent: 10,
    campaignTokens: 10_000,
  }] });
  const result = buildSeatComparisons([arm], observations);
  close(result.arms[0].observed.docsPerWeek, 100);
  close(result.arms[0].observed.docsPerMonth, 100 * 52 / 12);
  const plus = result.rows.find(({ plan }) => plan === "plus");
  const pro5x = result.rows.find(({ plan }) => plan === "pro-5x");
  close(plus.docsPerMonth, 100 * 52 / 12);
  close(pro5x.docsPerMonth, 500 * 52 / 12);
  assert.equal(plus.seatsFor1000Documents, 3);
  assert.equal(plus.seatUsdFor1000Documents, 60);
  assert.equal(plus.breakEvenDocuments, 101);
  assert.equal(plus.breakEvenReachable, true);
  close(plus.acceptedDocsPerMonth, plus.docsPerMonth * 0.8);
});

test("should reject non-allowlisted observation fields and keep five-hour capacity N-A", () => {
  assert.throws(() => validateSeatObservations({ schemaVersion: 1, observations: [{
    arm: "sol-medium", provider: "chatgpt", status: "N-A",
    reason: "weekly-window-source-gap", unsafe: "must not render",
  }] }), /Unknown observation field/u);
  const observations = validateSeatObservations({ schemaVersion: 1, observations: [{
    arm: "gemini-low", provider: "gemini", status: "scenario",
    method: "account-percent/campaign-token-ratio", sourceStatus: "observed",
    basePlan: "ai-pro", windowMinutes: 300, usedPercent: 10, campaignTokens: 10_000,
  }] });
  const result = buildSeatComparisons([{ arm: "gemini-low", documents: 10,
    attemptedDocuments: 10, acceptedDocuments: 8, totalTokens: 10_000, apiUsd: 1 }], observations);
  assert.equal(result.arms[0].status, "N-A");
  assert.equal(result.arms[0].reason, "non-weekly-window");
});

test("should load attempts from campaign and codex replay without deduplication", async () => {
  const root = await mkdtemp(join(tmpdir(), "cost-calculator-"));
  try {
    const base = join(root, "docs/reviews/refresh-benchmark/vtest");
    const first = join(base, "campaign/gemini-medium");
    const replay = join(base, "codex-replay/campaign/gemini-medium");
    await mkdir(first, { recursive: true });
    await mkdir(replay, { recursive: true });
    await writeFile(join(first, "doc.attempt-1.receipt.json"), JSON.stringify(receipt()));
    await writeFile(join(replay, "doc.attempt-2.receipt.json"), JSON.stringify(receipt()));
    const entries = await loadReceiptEntries(root, "vtest");
    assert.equal(entries.length, 2);
    assert.equal(aggregateReceipts(entries)[0].receiptCount, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("should recover input and output rates by receipt regression", () => {
  const sample = (inputTokens, outputTokens) => receipt({
    requested: { modelId: "gpt-4.1", transportProviderId: "openai-api" },
    actual: { usage: { inputTokens, outputTokens },
      costUsd: (inputTokens * 2 + outputTokens * 8) / 1_000_000 },
  });
  const [rates] = regressObservedRates([sample(1000, 100), sample(200, 500)]);
  close(rates.inputUsdPerMillion, 2);
  close(rates.outputUsdPerMillion, 8);
});

test("should parse a seat-observation path and render a report", () => {
  const options = parseArgs(["--campaign", "v101b", "--plan-gemini", "pro",
    "--plan-chatgpt", "plus", "--gemini-weekly-tokens", "1000000",
    "--seat-observations", "seat.json"]);
  assert.equal(options.geminiPlan, "ai-pro");
  assert.equal(options.seatObservations, "seat.json");
  const report = buildReport([receipt()], { ...options, cycleDocuments: 100 });
  assert.match(renderMarkdown(report), /Siège vs token/u);
  assert.equal(report.arms[0].perBenchmarkCycle.documents, 100);
});
