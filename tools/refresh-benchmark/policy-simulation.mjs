// Before / after of the production refresh policy on the 100 v101b documents, offline, from archived
// outputs only (i-cond request 2026-09-19). Strict bound of the oracle v3 reference.
//   before = production today (deploy/k8s/34-refresh-cronjob.yaml): gpt-6-astra low as primary (2
//            quality attempts), gemini-3.8-flash low as REPLACEMENT when the primary fails (one call);
//   after  = CP: astra-medium, then a gemini-3.8-flash low VERIFICATION of every accepted output
//            (precision-cascade.mjs); a document astra-medium refuses is scored as missed, and also
//            with the same replacement fallback (gemini-low output, unfiltered) as a variant.
// Sensitivity: the fallback share of production is unknown (quota breaker); the "before" is also
// given with the fallback forced on every document (gemini-low alone), as the other bound.
//
//   node tools/refresh-benchmark/policy-simulation.mjs

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { ORACLE_V3_DIR } from "./oracle-v3-lib.mjs";
import { cascadeOf } from "./precision-cascade.mjs";
import { aggregate, scoreCase, unresolvedUnits } from "./score-oracle-v3.mjs";

const readJsonIfPresent = async (path) => {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
};
const f = (value) => value === null || value === undefined ? "N-A" : value.toFixed(3);
const pts = (a, b) => a === null || b === null ? "N-A" : `${b - a >= 0 ? "+" : ""}${(100 * (b - a)).toFixed(1)}`;

async function accepted(directory, stem) {
  const receipt = await readJsonIfPresent(join(directory, `${stem}.receipt.json`));
  if (!receipt?.validation?.accepted) return null;
  return readJsonIfPresent(join(directory, `${stem}.output.json`));
}

export async function simulate({ repositoryRoot = process.cwd() } = {}) {
  const v101b = resolve(repositoryRoot, "docs/reviews/refresh-benchmark/v101b");
  const manifest = JSON.parse(await readFile(join(v101b, "manifest.json"), "utf8"));
  const v3 = resolve(repositoryRoot, ORACLE_V3_DIR);
  const gold = JSON.parse(await readFile(join(v3, "consensus.json"), "utf8"));
  const neutral = unresolvedUnits((await readJsonIfPresent(join(v3, "unresolved.json")))?.entries ?? []);
  const cp = cascadeOf("astra-medium");
  const cases = { before: [], beforeAllFallback: [], after: [], afterWithFallback: [] };
  const calls = { before: { astra: 0, gemini: 0 }, after: { astra: 0, gemini: 0 } };
  const perDocument = [];
  for (const document of manifest.documents) {
    const units = gold.units.filter(({ doc_sha: digest }) => digest === document.sha256);
    const options = { useStageAliases: true, partialOracle: false, neutralUnits: neutral.filter(({ documentId }) => documentId === document.id) };
    const astraLow = await accepted(join(v101b, "codex-replay/campaign/astra-low"), `${document.id}--astra-low.attempt-1`);
    const geminiLow = await accepted(join(v101b, "campaign/gemini-low"), `${document.id}--gemini-low.attempt-1`);
    const filtered = await accepted(resolve(repositoryRoot, cp.dir, "campaign"), `${document.id}--${cp.variant}.attempt-1`);
    const score = (output) => scoreCase(output ? { state: "accepted", output } : { state: "refused" }, document, units, options);
    // Before: astra-low, replaced by gemini-low only when astra-low has no accepted output.
    const before = astraLow ?? geminiLow;
    calls.before.astra += 1; if (!astraLow) calls.before.gemini += 1;
    cases.before.push(score(before)); cases.beforeAllFallback.push(score(geminiLow));
    // After: CP (astra-medium then a gemini-low verification of every accepted output).
    calls.after.astra += 1; if (filtered) calls.after.gemini += 1;
    cases.after.push(score(filtered)); cases.afterWithFallback.push(score(filtered ?? geminiLow));
    perDocument.push({ documentId: document.id, beforeFrom: astraLow ? "astra-low" : geminiLow ? "gemini-low (repli)" : "aucune",
      afterFrom: filtered ? "CP" : "aucune" });
  }
  const totals = Object.fromEntries(Object.entries(cases).map(([name, list]) => [name, aggregate(list)]));
  const waterloo = manifest.documents.findIndex(({ id }) => id.startsWith("waterloo-"));
  const result = { generatedAt: new Date().toISOString(), network: "none", totals, calls,
    fallbackUsedBefore: perDocument.filter(({ beforeFrom }) => beforeFrom !== "astra-low").length,
    waterloo: waterloo >= 0 ? { documentId: manifest.documents[waterloo].id,
      before: cases.before[waterloo], after: cases.after[waterloo] } : null };
  const out = resolve(repositoryRoot, "docs/reviews/refresh-benchmark/v101b/policy-simulation");
  await (await import("node:fs/promises")).mkdir(out, { recursive: true });
  await writeFile(join(out, "simulation.json"), `${JSON.stringify({ ...result, perDocument }, null, 1)}\n`);
  const row = (label, t) => `| ${label} | ${f(t.precision)} | ${f(t.recall)} | ${f(t.f1)} | ${t.tp} | ${t.fp} | ${t.fn} |`;
  const lines = ["# Simulation avant / après — politique de production contre CP (100 documents du banc, référence oracle v3, stricte)", "",
    "| Politique | P | R | F1 | VP | FP | FN |", "|---|---:|---:|---:|---:|---:|---:|",
    row("Avant : astra-low, repli gemini-low sur échec (production)", totals.before),
    row("Après : CP (astra-medium → vérification gemini-low)", totals.after),
    row("Après, avec le même repli gemini-low sur refus d'astra-medium", totals.afterWithFallback),
    row("Borne : repli sur tous les documents (gemini-low seul)", totals.beforeAllFallback), "",
    `Écart après − avant : précision ${pts(totals.before.precision, totals.after.precision)} pts, rappel ${pts(totals.before.recall, totals.after.recall)} pts, F1 ${pts(totals.before.f1, totals.after.f1)} pts.`,
    `Repli utilisé dans l'« avant » sur le banc : ${result.fallbackUsedBefore}/100 documents.`,
    `Appels par document : avant ${calls.before.astra / 100} Astra + ${calls.before.gemini / 100} Gemini ; après ${calls.after.astra / 100} Astra + ${calls.after.gemini / 100} Gemini.`, ""];
  await writeFile(join(out, "simulation.md"), `${lines.join("\n")}\n`);
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await simulate();
  console.log(JSON.stringify({ totals: Object.fromEntries(Object.entries(result.totals).map(([k, t]) => [k, { p: t.precision, r: t.recall, f1: t.f1, tp: t.tp, fp: t.fp, fn: t.fn }])),
    calls: result.calls, fallback: result.fallbackUsedBefore, waterloo: result.waterloo }));
}
