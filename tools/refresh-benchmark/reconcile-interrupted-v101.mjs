import { appendFile, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const root = process.env.BENCHMARK_RESULT_ROOT
  || (() => { throw new Error("BENCHMARK_RESULT_ROOT is required"); })();
const campaign = process.env.BENCHMARK_CAMPAIGN ?? "v101";
const campaignRoot = resolve(root, "campaign");
const completedAt = new Date().toISOString();
let reconciled = 0;

async function exists(path) {
  try { await readFile(path); return true; }
  catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

for (const armEntry of await readdir(campaignRoot, { withFileTypes: true })) {
  if (!armEntry.isDirectory()) continue;
  const armRoot = resolve(campaignRoot, armEntry.name);
  for (const name of await readdir(armRoot)) {
    if (!name.endsWith(".intent.json")) continue;
    const intentPath = resolve(armRoot, name);
    const receiptPath = resolve(armRoot, name.replace(/\.intent\.json$/u, ".receipt.json"));
    if (await exists(receiptPath)) continue;
    const intent = JSON.parse(await readFile(intentPath, "utf8"));
    const started = Date.parse(intent.startedAt);
    const receipt = { schemaVersion: 2, campaign, arm: intent.arm,
      documentId: intent.documentId, attemptNumber: intent.attempt, status: "failed", terminal: true,
      requestCount: null, requested: { ...intent.requested, transportTimeoutMs: 480_000 },
      accountPseudonym: null, wire: null, terminalSse: null, actual: null,
      validation: { layers: { transport: { accepted: false },
        terminalStream: { accepted: false }, json: null,
        v9: { accepted: false, error: null } }, accepted: false },
      latency: { startedAt: intent.startedAt, completedAt,
        totalMs: Number.isFinite(started) ? Date.parse(completedAt) - started : null,
        networkMs: null },
      retry: { eligible: false, reason: null, previousAttempt: intent.attempt === 2 ? 1 : null },
      error: { category: "operator-interrupted", code: "PROCESS_LIFECYCLE_TERMINATION",
        httpStatus: null },
      artifacts: { intent: `/results/campaign/${intent.arm}/${basename(intentPath)}`,
        receipt: `/results/campaign/${intent.arm}/${basename(receiptPath)}`,
        raw: null, output: null },
      redaction: { allowlistedFieldsOnly: true, secretsIncluded: false } };
    await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`, { flag: "wx" });
    await appendFile(resolve(root, "logs", `${intent.arm}.log`), `${JSON.stringify({
      at: completedAt, arm: intent.arm, event: "operator-reconciled", documentId: intent.documentId,
      attempt: intent.attempt, status: "failed", receipt: receipt.artifacts.receipt })}\n`);
    reconciled += 1;
  }
}

console.log(JSON.stringify({ campaign, reconciled,
  classification: "operator-interrupted", retryEligible: false }));
