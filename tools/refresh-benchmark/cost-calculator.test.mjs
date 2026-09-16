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
  buildReport,
  chatgptReserveRange,
  loadReceiptEntries,
  parseArgs,
  regressObservedRates,
  renderMarkdown,
  simulatedCost,
  subscriptionCost,
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

test("should calculate a subscription equivalent from weekly tokens", () => {
  const result = subscriptionCost(2_000_000, 20, 1_000_000);
  close(result.usdPerToken, 20 / (1_000_000 * 52 / 12));
  close(result.usd, 40 / (52 / 12));
  assert.deepEqual(chatgptReserveRange("gpt-5.6-sol", "pro-5x", 10_000),
    [500_000, 5_000_000]);
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
  close(arm.apiUsd, (1000 * 0.75 + 700 * 3.75) / 1_000_000);
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

test("should parse CLI plans and render a report", () => {
  const options = parseArgs(["--campaign", "v101b", "--plan-gemini", "pro",
    "--plan-chatgpt", "plus", "--gemini-weekly-tokens", "1000000"]);
  assert.equal(options.geminiPlan, "ai-pro");
  const report = buildReport([receipt()], { ...options, cycleDocuments: 100 });
  assert.match(renderMarkdown(report), /quota burn = 0%/u);
  assert.equal(report.arms[0].perBenchmarkCycle.documents, 100);
});
