// Runner de campagne v100 : un conteneur, N documents, un reçu par document.
// Il n'invente rien : il enchaîne run-case.mjs, document par document, et s'arrête
// proprement au premier signe de quota (429 / RESOURCE_EXHAUSTED).
// Aucune retry de qualité : run-case.mjs refuse déjà d'écraser un reçu existant.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

const required = (name) => process.env[name] || (() => { throw new Error(`${name} is required`); })();
const repositoryRoot = required("BENCHMARK_REPOSITORY_ROOT");
const outputDir = required("BENCHMARK_OUTPUT_DIR");
const variantName = required("BENCHMARK_VARIANT");
const campaign = required("BENCHMARK_CAMPAIGN");
const manifest = JSON.parse(readFileSync(
  resolve(repositoryRoot, `docs/reviews/refresh-benchmark/${campaign}/manifest.json`), "utf8"));

const slice = process.env.BENCHMARK_V100_SLICE ?? "";
const [sliceFrom, sliceTo] = slice
  ? slice.split("-").map((value) => Number(value))
  : [1, manifest.documents.length];
if (!Number.isInteger(sliceFrom) || !Number.isInteger(sliceTo) || sliceFrom < 1
  || sliceTo > manifest.documents.length || sliceFrom > sliceTo) {
  throw new Error(`Invalid BENCHMARK_V100_SLICE: ${slice}`);
}
const budget = Number(process.env.BENCHMARK_V100_MAX_REQUESTS ?? "100");
// Fenêtre d'exécution : le lot n'engage pas un nouveau document au-delà de cette
// durée, pour ne jamais être coupé au milieu d'une requête déjà facturée.
const deadlineMs = Number(process.env.BENCHMARK_V100_DEADLINE_MS ?? "0");
const batchStarted = Date.now();

const logPath = resolve(outputDir, "batch-log.jsonl");
const log = (record) => appendFileSync(logPath, `${JSON.stringify(record)}\n`);

// Un refus de qualité contient des sha et des extraits : chercher « 429 » en sous-chaîne
// y produit des faux positifs. Le quota se lit sur le transport, pas sur le contenu.
const quotaSignals = [/RESOURCE_EXHAUSTED/u, /\b429\b[^\d]{0,40}(Too Many|quota|rate)/iu,
  /HTTP\s*429/iu, /"code"\s*:\s*429/u, /rate[ _-]?limit/iu, /quota exceeded/iu];
const isQuota = (receipt, stdout) => {
  if (receipt?.wire?.httpStatus === 429) return true;
  if (receipt && receipt.actual !== null) return false;
  const text = `${JSON.stringify(receipt?.error ?? null)} ${stdout.slice(-4000)}`;
  return quotaSignals.some((signal) => signal.test(text));
};

let sent = 0;
let stopped = null;
const summary = [];
for (const [index, document] of manifest.documents.entries()) {
  const position = index + 1;
  if (position < sliceFrom || position > sliceTo) continue;
  const caseId = `${document.id}--${variantName}`;
  const receiptPath = resolve(outputDir, `${caseId}.receipt.json`);
  if (existsSync(receiptPath)) {
    summary.push({ position, id: document.id, skipped: "receipt-exists" });
    continue;
  }
  if (sent >= budget) { stopped = "budget"; break; }
  if (deadlineMs > 0 && Date.now() - batchStarted >= deadlineMs) { stopped = "deadline"; break; }
  const started = Date.now();
  const child = spawnSync("/workspace/node_modules/.bin/tsx",
    ["tools/refresh-benchmark/run-case.mjs"], {
      cwd: repositoryRoot, encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, BENCHMARK_DOCUMENT: document.id, BENCHMARK_ATTEMPT: "1" },
    });
  sent += 1;
  const receipt = existsSync(receiptPath)
    ? JSON.parse(readFileSync(receiptPath, "utf8")) : null;
  const stdout = child.stdout ?? "";
  const record = {
    position, id: document.id, city: document.city, sizeBucket: document.sizeBucket,
    exitCode: child.status, wallMs: Date.now() - started,
    status: receipt?.status ?? "no-receipt",
    accepted: receipt?.validation?.accepted ?? null,
    httpStatus: receipt?.wire?.httpStatus ?? null,
    finishReason: receipt?.actual?.finishReason ?? null,
    totalMs: receipt?.timing?.totalMs ?? null,
    launcherError: receipt ? null : (child.stderr ?? "").slice(-600),
  };
  summary.push(record);
  log(record);
  process.stdout.write(`${JSON.stringify(record)}\n`);
  if (isQuota(receipt, stdout)) { stopped = "quota"; break; }
}

const result = { campaign, variant: variantName, requestsSent: sent, stopped, summary };
log({ batchSummary: result });
console.log(JSON.stringify({ campaign, variant: variantName, requestsSent: sent, stopped,
  processed: summary.filter((entry) => !entry.skipped).length }));
