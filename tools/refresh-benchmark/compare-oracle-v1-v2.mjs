// Offline replay of the frozen receipts under the v1 scorer and the realigned v2 scorer.
// No network, no model call: it reads persisted outputs, the frozen v1 oracle and manual-oracle-v2.
//
// Two populations are reported side by side, because they answer different questions:
//   accepted   the product metric - only the outputs that passed the six validation layers;
//   fixed      the content diagnostic - every launched output, accepted or not, so a campaign is
//              compared on the same documents rather than on whatever it happened to get accepted.
// Waterloo is excluded from the macro averages in both, its oracle being deliberately partial.
//
// Each arm also carries the per-rule decomposition (R1 alone, R2 alone), which is what shows that
// the realignment is not a score inflation: R2 enlarges the precision denominator and lowers as
// many cells as it raises.

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { scoreValid } from "./score-v3.mjs";
import { scoreValidV2 } from "./score-oracle-v2.mjs";
import { arms as v101Arms } from "./v101-arms.mjs";
import { microF1 } from "./v101-score-lib.mjs";

const required = (name) => process.env[name] || (() => { throw new Error(`${name} is required`); })();
const repositoryRoot = required("BENCHMARK_REPOSITORY_ROOT");
const outputPath = required("BENCHMARK_COMPARISON_OUTPUT");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const benchmarkRoot = resolve(repositoryRoot, "docs/reviews/refresh-benchmark");

const DEFAULT_ARMS = [
  { campaign: "v9", variant: "gemini-low", directory: "campaign-real", contract: "immo-pv-extraction-v5" },
  { campaign: "v12", variant: "sonnet-cloudcode", directory: "campaign-cloudcode", contract: "immo-pv-extraction-v5" },
  { campaign: "v12", variant: "sonnet-direct", directory: "campaign-direct", contract: "immo-pv-extraction-v5" },
  { campaign: "v13", variant: "gemini-low", directory: "campaign-gemini", contract: "immo-pv-extraction-v8" },
  { campaign: "v13", variant: "sonnet-cloudcode", directory: "campaign-cloudcode", contract: "immo-pv-extraction-v8" },
];
const v101bArms = () => Object.keys(v101Arms).map((variant) => ({ campaign: "v101b", variant,
  directory: `campaign/${variant}`, contract: "immo-pv-extraction-v9", attempted: true,
  oracleCampaign: "v13", executionSubdir: v101Arms[variant].lane === "codex"
    ? "codex-replay" : null }));
const configuredArms = process.env.BENCHMARK_COMPARISON_ARMS;
const arms = configuredArms === "v101b" ? v101bArms()
  : configuredArms ? JSON.parse(configuredArms) : DEFAULT_ARMS;

const oracleV2Bytes = await readFile(resolve(benchmarkRoot, "manual-oracle-v2.json"));
const oracleV2 = JSON.parse(oracleV2Bytes.toString("utf8"));

const mean = (values) => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const macro = (cases, pick) => {
  const values = cases.filter((entry) => !entry.partialOracle && entry.oracleAvailable !== false)
    .map(pick).filter((value) => value !== null && value !== undefined);
  return values.length ? mean(values) : null;
};

const results = [];
for (const arm of arms) {
  const campaignRoot = resolve(benchmarkRoot, arm.campaign);
  const executionRoot = arm.executionSubdir
    ? resolve(campaignRoot, arm.executionSubdir) : campaignRoot;
  const manifest = await readJson(resolve(campaignRoot, "manifest.json"));
  const oracleV1Bytes = await readFile(resolve(benchmarkRoot,
    arm.oracleCampaign ?? arm.campaign, "manual-oracle.json"));
  const oracleV1 = JSON.parse(oracleV1Bytes.toString("utf8"));
  if (sha256(oracleV1Bytes) !== oracleV2.derivedFrom.sha256) {
    throw new Error(`Campaign ${arm.campaign} does not carry the frozen v1 oracle`);
  }
  const cases = [];
  for (const document of manifest.documents) {
    let stem = resolve(executionRoot, arm.directory, `${document.id}--${arm.variant}`);
    let receipt;
    if (arm.attempted) {
      for (const attempt of [2, 1]) {
        const candidate = `${stem}.attempt-${attempt}`;
        try { receipt = await readJson(`${candidate}.receipt.json`); stem = candidate; break; }
        catch (error) { if (error.code !== "ENOENT") throw error; }
      }
      if (!receipt) { cases.push({ documentId: document.id, state: "not_launched" }); continue; }
      if (!receipt.validation?.accepted) {
        cases.push({ documentId: document.id, accepted: false, state: "completed_invalid" });
        continue;
      }
    }
    let output;
    try { output = await readJson(`${stem}.output.json`); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      cases.push({ documentId: document.id, state: "not_launched" });
      continue;
    }
    receipt ??= await readJson(`${stem}.receipt.json`);
    const goldV1 = oracleV1.units.filter(({ doc_sha: digest }) => digest === document.sha256);
    const goldV2 = oracleV2.units.filter(({ doc_sha: digest }) => digest === document.sha256);
    if (goldV1.length !== goldV2.length) throw new Error(`Unit count drift on ${document.id}`);
    cases.push({ documentId: document.id, accepted: Boolean(receipt.validation?.accepted),
      state: receipt.validation?.accepted ? "completed_valid" : "completed_invalid",
      oracleAvailable: goldV2.length > 0,
      partialOracle: document.id === "waterloo-2026-08-18",
      v1: scoreValid(output, document, goldV1),
      r1: scoreValidV2(output, document, goldV1,
        { eligibleNodeTypes: ["Signal", "DesignationEvent"], useAlternateSites: false }),
      r2: scoreValidV2(output, document, goldV1, { stripNumbering: false, useAlternateSites: false }),
      v2: scoreValidV2(output, document, goldV2) });
  }
  const scored = cases.filter((entry) => entry.v1);
  const acceptedCases = scored.filter((entry) => entry.accepted);
  results.push({ ...arm, cases,
    totals: { planned: manifest.documents.length, launched: scored.length,
      accepted: acceptedCases.length },
    macroAccepted: { v1: macro(acceptedCases, (entry) => entry.v1.f1),
      v2: macro(acceptedCases, (entry) => entry.v2.f1),
      precisionV1: macro(acceptedCases, (entry) => entry.v1.precision),
      precisionV2: macro(acceptedCases, (entry) => entry.v2.precision),
      recallV1: macro(acceptedCases, (entry) => entry.v1.recall),
      recallV2: macro(acceptedCases, (entry) => entry.v2.recall) },
    macroFixed: { v1: macro(scored, (entry) => entry.v1.f1), r1: macro(scored, (entry) => entry.r1.f1),
      r2: macro(scored, (entry) => entry.r2.f1), v2: macro(scored, (entry) => entry.v2.f1),
      precisionV1: macro(scored, (entry) => entry.v1.precision),
      precisionV2: macro(scored, (entry) => entry.v2.precision),
      recallV1: macro(scored, (entry) => entry.v1.recall),
      recallV2: macro(scored, (entry) => entry.v2.recall) },
    microAccepted: { v1: microF1(acceptedCases, (entry) => entry.v1),
      v2: microF1(acceptedCases, (entry) => entry.v2) },
    microFixed: { v1: microF1(scored, (entry) => entry.v1),
      v2: microF1(scored, (entry) => entry.v2) } });
}

const result = { schemaVersion: 1, generatedAt: new Date().toISOString(), network: "none",
  oracleV1Sha256: oracleV2.derivedFrom.sha256, oracleV2Sha256: sha256(oracleV2Bytes),
  oracleUnits: oracleV2.units.length, addedUnits: oracleV2.realignment.addedUnits,
  addedSites: oracleV2.realignment.addedSites, rules: oracleV2.realignment.rules,
  macroExcludes: "waterloo-2026-08-18 (partial oracle by construction)", arms: results };
await writeFile(outputPath, `${JSON.stringify(result)}\n`, "utf8");
const round = (value) => value === null ? null : Number(value.toFixed(3));
console.log(JSON.stringify(results.map((arm) => ({ arm: `${arm.campaign}/${arm.variant}`,
  accepted: `${arm.totals.accepted}/${arm.totals.planned}`,
  acceptedF1: [round(arm.macroAccepted.v1), round(arm.macroAccepted.v2)],
  fixedF1: [round(arm.macroFixed.v1), round(arm.macroFixed.v2)] }))));
