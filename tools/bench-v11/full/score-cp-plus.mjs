// Score the real replay and precision cascade with the frozen oracle-676 scorer.
// Refuse incomplete campaigns: quota or infrastructure gaps are never refusals.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
const DIR = process.env.BENCH_DIR ?? new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const { scoreSource } = await import(`${DIR}/full/score-676.mjs`);
const manifest = JSON.parse(await readFile(`${DIR}/harness/manifest-v101b.json`, "utf8"));
const astraDir = `${DIR}/full/arms/astra-medium-rejeu`;
const cpDir = `${DIR}/full/arms/cp-plus-muse13-xhigh`;
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const jsonl = async (path) => (await readFile(path, "utf8")).split("\n").filter(Boolean).map(JSON.parse);
const documents = manifest.documents;
const astraMeta = await jsonl(`${astraDir}/meta.jsonl`);
const astraUsage = [];
const accepted = new Set();
const failureClasses = {};
for (const { id } of documents) {
  if (!existsSync(`${astraDir}/usage/medium--${id}.json`)) throw new Error(`Incomplete Astra transport: ${id}`);
  const receipt = await json(`${astraDir}/validated/medium--${id}.receipt.json`);
  if (receipt.validation.accepted) accepted.add(id);
  else {
    const key = receipt.validation.failureClass;
    failureClasses[key] = (failureClasses[key] ?? 0) + 1;
  }
  const { usage } = await json(`${astraDir}/usage/medium--${id}.json`);
  if (!Number.isFinite(usage?.inputTokens) || !Number.isFinite(usage?.outputTokens)) throw new Error(`Missing Astra usage: ${id}`);
  astraUsage.push({ documentId: id, ...usage });
}
const resolve = (dir, effort) => async (id) => {
  const path = `${dir}/validated/${effort}--${id}.output.json`;
  return existsSync(path) ? { state: "accepted", output: await json(path) } : { state: "refused" };
};
const astra = await scoreSource("GPT-6 Astra medium (rejeu v12)", "codex", resolve(astraDir, "medium"));
const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] ?? 0), 0);
// Same full-input/full-output convention as the v10 cost calculator. No cache discount.
const astraApi = (sum(astraUsage, "inputTokens") * 10 + sum(astraUsage, "outputTokens") * 50) / 1e6 / documents.length;
const quota = await jsonl(`${astraDir}/codex-quota.jsonl`);
const source = { label: astra.arm, accepted: astra.accepted, strict: astra.strict, failureClasses,
  usdApiEquivPerDoc: astraApi, usdSeatPerDoc: null,
  tokens: { n: astraUsage.length, input: sum(astraUsage, "inputTokens"), output: sum(astraUsage, "outputTokens") },
  quota: { before: quota[0], after: quota.at(-1), events: astraMeta.filter((row) => row.event === "QUOTA").length } };
await writeFile(`${DIR}/full/scores-astra-rejeu.json`, JSON.stringify({ arm: source, cases: astra.cases }, null, 1));
console.log(JSON.stringify(source));
if (process.argv.includes("--source-only")) process.exit(0);
const decisions = [];
for (const id of accepted) {
  if (!existsSync(`${cpDir}/decisions/${id}.json`)) throw new Error(`Incomplete CP+ review: ${id}`);
  if (!existsSync(`${cpDir}/validated/xhigh--${id}.output.json`)) throw new Error(`Missing filtered output: ${id}`);
  decisions.push(await json(`${cpDir}/decisions/${id}.json`));
}
const usages = [];
for (const file of (await readdir(`${cpDir}/usage`)).filter((name) => name.endsWith(".json"))) {
  const usage = await json(`${cpDir}/usage/${file}`);
  if (!Number.isFinite(usage.inputTokens) || !Number.isFinite(usage.outputTokens)) throw new Error(`Missing Muse usage: ${file}`);
  if (usage.model !== "muse-spark-1.3") throw new Error(`Unexpected reviewer model: ${usage.model}`);
  usages.push(usage);
}
const summary = await json(`${cpDir}/_summary.json`);
if (summary.stopped || summary.failed) throw new Error("CP+ stopped or failed; do not publish a complete score");
const cp = await scoreSource("CP+ (GPT-6 Astra medium → Muse Spark 1.3 xhigh)", "precision-cascade", resolve(cpDir, "xhigh"));
// Primary Meta page https://dev.meta.ai/models/muse-spark/, read 2026-11-13.
// A uses reported output; B adds reasoning separately. Real usage includes CLI context.
const reviewerApi = ((sum(usages, "inputTokens") - sum(usages, "cachedTokens")) * 1.25
  + sum(usages, "cachedTokens") * 0.15 + sum(usages, "outputTokens") * 4.25) / 1e6 / documents.length;
const extraReasoningApi = sum(usages, "reasoningTokens") * 4.25 / 1e6 / documents.length;
const surface = await json(`${cpDir}/surface.json`);
const arm = { label: cp.arm, accepted: cp.accepted, strict: cp.strict,
  actsJudged: decisions.reduce((total, row) => total + row.filter.acts, 0),
  actsRemoved: decisions.reduce((total, row) => total + row.filter.removed.length, 0),
  keptNoValidDecision: decisions.reduce((total, row) => total + row.filter.keptNoValidDecision, 0),
  supportedUngrounded: decisions.reduce((total, row) => total + row.filter.supportedUngrounded, 0),
  calls: usages.length, usdApiEquivPerDoc: astraApi + reviewerApi,
  usdApiEquivWithExtraReasoning: astraApi + reviewerApi + extraReasoningApi,
  reviewerApiPerCorpusDoc: reviewerApi, usdSeatPerDoc: null,
  tokens: { n: usages.length, input: sum(usages, "inputTokens"), output: sum(usages, "outputTokens"), reasoning: sum(usages, "reasoningTokens"), cached: sum(usages, "cachedTokens") },
  rates: { astra: { input: 10, output: 50, source: "harness/cost-calculator.mjs, 2026-09-16" },
    reviewer: { input: 1.25, cached: 0.15, output: 4.25, source: "https://dev.meta.ai/models/muse-spark/; 2026-11-13; primary" },
    denominator: documents.length, astraCacheDiscount: false },
  source, summary, surface: surface.summary };
await writeFile(`${DIR}/full/scores-cp-plus.json`, JSON.stringify({ arm, cases: cp.cases }, null, 1));
console.log(JSON.stringify(arm));
