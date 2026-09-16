import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { arms, usageCostUsd } from "./v101-arms.mjs";

const provenancePattern = /ungrounded|provenance|PDF excerpt/iu;

function percentile(values, ratio) {
  if (values.length === 0) return null;
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(ratio * sorted.length) - 1)];
}

function latestReceipts(receipts) {
  const latest = new Map();
  for (const receipt of receipts) {
    const previous = latest.get(receipt.documentId);
    if (!previous || (receipt.attemptNumber ?? 0) > (previous.attemptNumber ?? 0)) {
      latest.set(receipt.documentId, receipt);
    }
  }
  return [...latest.values()];
}

export function summarizeReceipts(receipts, arm, rateLimit = 0) {
  const terminal = latestReceipts(receipts);
  const completed = terminal.filter(({ status }) => status === "completed");
  const failed = terminal.filter(({ status }) => status === "failed");
  const latency = terminal.map(({ latency: value }) => value?.totalMs)
    .filter(Number.isFinite);
  const usages = terminal.map(({ actual }) => actual?.usage).filter(Boolean);
  const costs = usages.map((usage) => usageCostUsd(arm, usage)).filter(Number.isFinite);
  const profileFailures = completed.filter(({ validation }) =>
    validation?.accepted !== true && validation?.layers?.json?.valid === true);
  return {
    processed: terminal.length,
    accepted: completed.filter(({ validation }) => validation?.accepted === true).length,
    transport: failed.filter(({ error }) => (error?.httpStatus ?? 0) !== 429
      && (error?.category ?? "") !== "request-budget").length,
    rateLimit,
    json: completed.filter(({ validation }) => validation?.layers?.json?.valid !== true).length,
    profile: profileFailures.filter(({ validation }) =>
      !provenancePattern.test(validation?.layers?.v9?.error ?? "")).length,
    provenance: profileFailures.filter(({ validation }) =>
      provenancePattern.test(validation?.layers?.v9?.error ?? "")).length,
    budget: terminal.filter(({ cap, error }) => cap?.classification === "out-of-cap"
      || error?.category === "request-budget").length,
    latencyP50Ms: percentile(latency, 0.5),
    latencyP95Ms: percentile(latency, 0.95),
    inputTokens: usages.reduce((total, usage) =>
      total + (usage.inputTokens ?? usage.input_tokens ?? 0), 0),
    outputTokens: usages.reduce((total, usage) =>
      total + (usage.outputTokens ?? usage.output_tokens ?? 0), 0),
    costUsd: arm.prices ? Number(costs.reduce((total, cost) => total + cost, 0).toFixed(8)) : null,
  };
}

export function summarizeJudgeVerdicts(mapping, verdictsByJudge) {
  const armByAlias = new Map(mapping.map(({ alias, arm }) => [alias, arm]));
  const byArm = {};
  for (const [judge, records] of Object.entries(verdictsByJudge)) {
    for (const record of records) {
      const arm = armByAlias.get(record.alias);
      const usefulness = record.verdict?.usefulness;
      if (!arm || !Number.isInteger(usefulness)) continue;
      const target = byArm[arm] ??= { values: {} };
      (target.values[judge] ??= new Map()).set(record.alias, usefulness);
    }
  }
  return Object.fromEntries(Object.entries(byArm).map(([arm, { values }]) => {
    const summary = {};
    for (const [judge, scores] of Object.entries(values)) {
      const numbers = [...scores.values()];
      summary[judge] = { completed: numbers.length,
        meanUsefulness: Number((numbers.reduce((total, value) => total + value, 0)
          / numbers.length).toFixed(3)) };
    }
    const [leftName, rightName] = Object.keys(values);
    if (leftName && rightName) {
      const pairs = [...values[leftName]].filter(([alias]) => values[rightName].has(alias))
        .map(([alias, value]) => [value, values[rightName].get(alias)]);
      summary.agreement = { pairs: pairs.length,
        exact: pairs.filter(([left, right]) => left === right).length,
        meanAbsoluteDifference: pairs.length ? Number((pairs.reduce((total, [left, right]) =>
          total + Math.abs(left - right), 0) / pairs.length).toFixed(3)) : null };
    }
    return [arm, summary];
  }));
}

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function files(path, suffix) {
  try { return (await readdir(path)).filter((name) => name.endsWith(suffix)); }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
}

async function receipts(path) {
  return Promise.all((await files(path, ".receipt.json"))
    .map((name) => json(resolve(path, name))));
}

function laneFor(arm) {
  if (arm.lane === "codex") return "codex";
  if (arm.lane === "cloud") return "cloud";
  if (arm.lane === "anthropic") return "anthropic";
  return arm.lane;
}

async function rateLimitCount(root, arm) {
  try {
    const content = await readFile(resolve(root, "limits", `${laneFor(arm)}.jsonl`), "utf8");
    return content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
      .filter((event) => event.arm === arm.name && event.category === "rate-limit").length;
  } catch (error) { if (error?.code === "ENOENT") return 0; throw error; }
}

async function collectJudgeMetrics(resultRoot) {
  let mapping;
  try { ({ mapping } = await json(resolve(resultRoot, "judges", "blind-map.json"))); }
  catch (error) { if (error?.code === "ENOENT") return {}; throw error; }
  const verdicts = {};
  for (const [label, directory] of [["terra", "judge-terra"],
    ["opus46", "judge-opus46-thinking"]]) {
    const root = resolve(resultRoot, "judges", directory, "verdicts");
    const names = (await files(root, ".json")).filter((name) => !name.endsWith(".intent.json"));
    verdicts[label] = await Promise.all(names.map((name) => json(resolve(root, name))));
  }
  return summarizeJudgeVerdicts(mapping, verdicts);
}

export async function collectV101bMetrics(resultRoot) {
  const comparison = await json(resolve(resultRoot, "oracle-v2-comparison.json"));
  const oracleByArm = new Map(comparison.arms.map((entry) => [entry.variant, entry]));
  const judgesByArm = await collectJudgeMetrics(resultRoot);
  const rows = [];
  for (const arm of Object.values(arms)) {
    const executionRoot = arm.lane === "codex" ? resolve(resultRoot, "codex-replay") : resultRoot;
    const [armReceipts, limits, status] = await Promise.all([
      receipts(resolve(executionRoot, "campaign", arm.name)),
      rateLimitCount(executionRoot, arm),
      json(resolve(executionRoot, "status.json")),
    ]);
    const oracle = oracleByArm.get(arm.name);
    rows.push({ arm: arm.name, model: arm.model, effort: arm.effort ?? "off",
      state: status.arms?.[arm.name]?.state ?? "unknown",
      ...summarizeReceipts(armReceipts, arm, limits),
      oracleV2AcceptedF1: oracle?.macroAccepted?.v2 ?? null,
      oracleV2FixedF1: oracle?.macroFixed?.v2 ?? null,
      judges: judgesByArm[arm.name] ?? null });
  }
  return { schemaVersion: 1, campaign: "v101b", generatedAt: new Date().toISOString(),
    oracleMacroExcludes: comparison.macroExcludes, arms: rows };
}

export async function writeV101bReportData(resultRoot, output = resolve(resultRoot,
  "report-data.json")) {
  const temporary = `${output}.${process.pid}`;
  const data = await collectV101bMetrics(resultRoot);
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, output);
  return { output, arms: data.arms.length };
}

async function main() {
  const resultRoot = process.env.BENCHMARK_RESULT_ROOT
    || (() => { throw new Error("BENCHMARK_RESULT_ROOT is required"); })();
  console.log(JSON.stringify(await writeV101bReportData(resultRoot,
    process.env.BENCHMARK_REPORT_DATA_OUTPUT)));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
