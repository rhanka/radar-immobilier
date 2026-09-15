import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { arms, laneArms } from "./v101-arms.mjs";
import { writeOnce } from "./v101-probe-lib.mjs";

const root = process.env.BENCHMARK_RESULT_ROOT
  || (() => { throw new Error("BENCHMARK_RESULT_ROOT is required"); })();
async function json(path) { return JSON.parse(await readFile(resolve(root, path), "utf8")); }
const codex = await json("gates/codex-cap.json");
const gemini = await Promise.all(["medium", "high"].map((effort) =>
  json(`gates/gemini-${effort}-512.json`)));
const judges = await Promise.all(["gpt-5.6-terra", "gpt-oss-120b-medium"].map((name) =>
  json(`gates/judge-${name}.json`)));
if (!gemini.every(({ proved }) => proved)) throw new Error("Gemini MEDIUM/HIGH gate is not proved");
if (!judges.every(({ proved }) => proved)) throw new Error("Judge preflight gate is not proved");
const runnerDir = resolve(root, "gates/runner/campaign/mistral-small4");
const runnerReceipts = (await readdir(runnerDir)).filter((name) => name.endsWith(".receipt.json"));
const receiptValues = await Promise.all(runnerReceipts.map((name) => json(
  `gates/runner/campaign/mistral-small4/${name}`)));
if (receiptValues.length !== 2 || receiptValues.reduce((sum, value) => sum + value.requestCount, 0) !== 2) {
  throw new Error("Runner gate must prove exactly two documents and two requests");
}
const codexIncluded = codex.proved === true;
const selected = Object.values(arms).filter((arm) => codexIncluded || arm.lane !== "codex");
const files = Object.fromEntries(Object.entries(laneArms).map(([lane, names]) =>
  [lane, lane === "codex" && !codexIncluded ? 0 : names.length]));
const launch = { schemaVersion: 1, capturedAt: new Date().toISOString(),
  ownerDecision: { estimatedApiCostUsd: 125.82, requestedCohortCount: 24,
    excludedModel: "Codex 5.3", geminiMediumHighIncluded: true },
  enumeration: { matrixArms: 30, unavailableCodex53Arms: 4,
    addressableArms: 26, discrepancy: "30 minus four unavailable arms is 26; no unspecified arm excluded" },
  codexIncluded, commonMaxOutputTokens: 32_768, files,
  runnerGate: { documents: receiptValues.length,
    requests: receiptValues.reduce((sum, value) => sum + value.requestCount, 0) },
  judgesPreflight: judges.filter(({ proved }) => proved).length,
  selectedArms: selected.map(({ name }) => name),
  redaction: { allowlistedFieldsOnly: true, secretsIncluded: false } };
await writeOnce(resolve(root, "gates/campaign-launch.json"), launch);
const initial = { schemaVersion: 1, campaign: "v101", launchedAt: null,
  codexIncluded, commonMaxOutputTokens: 32_768, files,
  arms: Object.fromEntries(selected.map(({ name }) => [name, { state: "queued", total: 100,
    processed: 0, accepted: 0, errors: 0, lastReceipt: null, requests: 0, etaSeconds: null }])) };
try { await writeFile(resolve(root, "status.json"), `${JSON.stringify(initial, null, 2)}\n`, { flag: "wx" }); }
catch (error) { if (error?.code !== "EEXIST") throw error; }
console.log(JSON.stringify({ arms: selected.length, codexIncluded, files,
  judges: launch.judgesPreflight, runnerRequests: launch.runnerGate.requests }));
