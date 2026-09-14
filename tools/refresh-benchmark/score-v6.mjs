import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const required = (name) => process.env[name] || (() => { throw new Error(`${name} is required`); })();
const repositoryRoot = required("BENCHMARK_REPOSITORY_ROOT");
const resultRoot = required("BENCHMARK_RESULT_ROOT");
const outputPath = required("BENCHMARK_SCORE_OUTPUT");
const campaign = process.env.BENCHMARK_CAMPAIGN ?? "v6";
const variant = process.env.BENCHMARK_VARIANT ?? "gemini-low";
delete process.env.BENCHMARK_SCORE_OUTPUT;
const { scoreValid } = await import("./score-v3.mjs");
const { citationHealth } = await import("./score-v4.mjs");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const campaignRoot = resolve(repositoryRoot, `docs/reviews/refresh-benchmark/${campaign}`);
const manifest = await readJson(resolve(campaignRoot, "manifest.json"));
const oracle = await readJson(resolve(campaignRoot, "manual-oracle.json"));
const promptFreeze = await readJson(resolve(campaignRoot, "prompt-freeze.json"));
const cases = [];
const efforts = new Set();
const models = new Set();
for (const document of manifest.documents) {
  const stem = `${document.id}--${variant}`;
  let receipt;
  try { receipt = await readJson(resolve(resultRoot, `${stem}.receipt.json`)); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (receipt?.requested?.effort) efforts.add(receipt.requested.effort.toUpperCase());
  if (receipt?.requested?.modelId) models.add(receipt.requested.modelId);
  let raw;
  let output;
  if (receipt) raw = await readFile(resolve(resultRoot, `${stem}.raw.txt`), "utf8");
  if (receipt?.validation?.accepted) output = await readJson(resolve(resultRoot, `${stem}.output.json`));
  const text = await readFile(resolve(repositoryRoot, document.runtimeTextRelativePath), "utf8");
  const pages = text.split("\f"); if (pages.at(-1) === "") pages.pop();
  cases.push({ documentId: document.id,
    state: !receipt ? "not_launched" : receipt.validation.accepted ? "completed_valid" : "completed_invalid",
    httpStatus: receipt?.wire?.httpStatus ?? null, timingMs: receipt?.timing?.totalMs ?? null,
    usage: receipt?.actual?.usage ?? null, terminalFinishReason: receipt?.wire?.terminalSse?.lastData?.finishReason ?? null,
    validation: receipt?.validation ?? null,
    raw: raw ? { sha256: sha256(raw), characters: [...raw].length, bytes: Buffer.byteLength(raw) } : null,
    outputSha256: output ? sha256(JSON.stringify(output)) : null,
    quality: output ? scoreValid(output, document,
      oracle.units.filter(({ doc_sha: digest }) => digest === document.sha256)) : null,
    citations: output ? citationHealth(output, document, pages) : null });
}
const accepted = cases.filter(({ state }) => state === "completed_valid").length;
const launched = cases.filter(({ state }) => state !== "not_launched").length;
const campaignStopped = launched < manifest.documents.length;
const blockingCase = cases.find(({ httpStatus, terminalFinishReason }) =>
  httpStatus === 429 || terminalFinishReason === "MAX_TOKENS");
const stopReason = !campaignStopped ? null : blockingCase
  ? `${blockingCase.documentId} returned ${blockingCase.httpStatus === 429 ? "HTTP 429" : "MAX_TOKENS"}`
  : "campaign incomplete";
if (efforts.size > 1) throw new Error("Campaign receipts do not share one effort");
const effort = [...efforts][0] ?? null;
if (models.size > 1) throw new Error("Campaign receipts do not share one model");
const result = { schemaVersion: 1, campaign, model: [...models][0] ?? null,
  effort, maxOutputTokens: promptFreeze.maxOutputTokens, cases,
  totals: { launched: cases.filter(({ state }) => state !== "not_launched").length,
    accepted, planned: manifest.documents.length }, campaignStopped, stopReason };
await writeFile(outputPath, JSON.stringify(result), { flag: "wx" });
console.log(JSON.stringify({ launched: result.totals.launched, accepted, planned: result.totals.planned }));
