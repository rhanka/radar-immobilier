import { usageCostUsd } from "./v101-arms.mjs";

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
