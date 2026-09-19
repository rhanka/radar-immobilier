// Measures of the precision cascade astra-low -> gemini-low against the oracle v3 reference, offline:
// P/R/F1 before (astra-low) and after (filtered), in the strict bound (unresolved items neutral);
// every removed act classified by what the ACT was (not the removal): "correctAct" (it matched a
// reference unit by itself - removing it is a filter error, the potential recall cost), "neutral"
// (it only matched an unresolved item) or "falseAct" (it matched nothing - removing it is a
// justified removal, the precision gain); the recall actually lost is TP before - TP after. Cost in
// API equivalent (cost-calculator rate card) and latency, of the Gemini pass and cumulated with the
// astra-low arm it consumes (costs.md, receipts).
//
//   node tools/refresh-benchmark/precision-cascade-report.mjs

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { apiCost, RATE_CARDS, SUBSCRIPTION_PLANS, WEEKS_PER_MONTH } from "./cost-calculator.mjs";
import { ORACLE_V3_DIR } from "./oracle-v3-lib.mjs";
import { cascadeOf } from "./precision-cascade.mjs";
import { scoreValidV2 } from "./score-oracle-v2.mjs";
import { aggregate, scoreCase, unresolvedUnits } from "./score-oracle-v3.mjs";

const readJsonIfPresent = async (path) => {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
};
const f = (value) => value === null || value === undefined ? "N-A" : value.toFixed(3);
const pts = (before, after) => before === null || after === null ? "N-A" : `${after - before >= 0 ? "+" : ""}${(100 * (after - before)).toFixed(1)}`;
const seconds = (ms) => Number.isFinite(ms) ? (ms / 1000).toFixed(1) : "N-A";

export function classifyRemoved(output, act, document, units, neutralUnits, options) {
  const ids = new Set(act.nodeIds);
  const alone = { ...output, nodes: output.nodes.filter(({ id }) => ids.has(id)),
    edges: (output.edges ?? []).filter(({ source, target }) => ids.has(source) && ids.has(target)) };
  if (scoreValidV2(alone, document, units, options).tp > 0) return "correctAct";
  if (neutralUnits.length && scoreValidV2(alone, document, [], { ...options, neutralUnits }).neutralizedGroups > 0) return "neutral";
  return "falseAct";
}

// Seat cost (owner request 2026-09-19: never N-A), the method of report v10 section 8 and of
// cost-calculator.mjs (api-cost-proportional): factor = plan USD per month / (API-equivalent USD of
// the measured weekly burn / quota fraction x WEEKS_PER_MONTH); seat of a pass = its API cost x the
// factor of its provider. Burns: burn/seat-observations.json (measured ChatGPT and Gemini rows).
// (Superseded on 2026-09-19: a token-linear capacity read from the costs.md snapshot, whose own note
// says the linear-in-tokens hypothesis is unverified - it under-weighted output-heavy arms.)
export function seatFactors(observations) {
  const factor = (provider, plan) => {
    const burn = observations.find((value) => value.provider === provider && value.status === "measured");
    const monthly = SUBSCRIPTION_PLANS[provider]?.[plan]?.monthlyUsd;
    if (!burn || !monthly) return null;
    const quota = (burn.quotaDeltaPercent ?? burn.usedPercent) / 100;
    return { plan: `${provider}/${plan}`, usdPerMonth: monthly, burnArm: burn.arm, burnApiUsd: burn.apiEquivalentUsd,
      burnQuotaPercent: quota * 100, factor: monthly / (burn.apiEquivalentUsd / quota * WEEKS_PER_MONTH) };
  };
  return { codex: factor("chatgpt", "pro-20x"), google: factor("gemini", "ai-pro") };
}
export function armTokens(costsMd, arm) {
  const row = costsMd.match(new RegExp(`^\\| ${arm} \\| [^|]+ \\| [^|]+ \\| ([0-9,]+) / [0-9,]+ \\| [^|]+ \\| [^|]+ \\| ([0-9,]+) \\| \\$([0-9.]+) \\|`, "mu"));
  const number = (value) => Number(String(value).replace(/,/gu, ""));
  return row ? { input: number(row[1]), billableOutput: number(row[2]), apiUsd: number(row[3]) } : null;
}

export async function report({ repositoryRoot = process.cwd(), source: sourceArm = "astra-low" } = {}) {
  const config = cascadeOf(sourceArm);
  const SOURCE_DIR = config.sourceDir; const CASCADE_VARIANT = config.variant;
  const v3 = resolve(repositoryRoot, ORACLE_V3_DIR); const cascade = resolve(repositoryRoot, config.dir);
  const manifest = JSON.parse(await readFile(resolve(repositoryRoot, "docs/reviews/refresh-benchmark/v101b/manifest.json"), "utf8"));
  const gold = JSON.parse(await readFile(join(v3, "consensus.json"), "utf8"));
  const unresolved = await readJsonIfPresent(join(v3, "unresolved.json"));
  const neutral = unresolvedUnits(unresolved?.entries ?? []);
  const options = { useStageAliases: true, partialOracle: false };
  const before = []; const after = []; const removed = { correctAct: 0, neutral: 0, falseAct: 0 }; const examples = [];
  let acts = 0; let removedActs = 0; let supportedUngrounded = 0; let keptNoValidDecision = 0; let unknownIds = 0;
  const receipts = []; let documentsFiltered = 0; const refusedDocuments = [];
  for (const document of manifest.documents) {
    const units = gold.units.filter(({ doc_sha: digest }) => digest === document.sha256);
    const neutralUnits = neutral.filter(({ documentId }) => documentId === document.id);
    const sourceReceipt = await readJsonIfPresent(join(resolve(repositoryRoot, SOURCE_DIR), `${document.id}--${sourceArm}.attempt-1.receipt.json`));
    const source = sourceReceipt?.validation?.accepted
      ? await readJsonIfPresent(join(resolve(repositoryRoot, SOURCE_DIR), `${document.id}--${sourceArm}.attempt-1.output.json`)) : null;
    if (!source) refusedDocuments.push(document.id);
    const filtered = await readJsonIfPresent(join(cascade, "campaign", `${document.id}--${CASCADE_VARIANT}.attempt-1.output.json`));
    before.push(scoreCase(source ? { state: "accepted", output: source } : { state: "refused" }, document, units, { ...options, neutralUnits }));
    after.push(scoreCase(filtered ? { state: "accepted", output: filtered } : { state: "refused" }, document, units, { ...options, neutralUnits }));
    const record = await readJsonIfPresent(join(cascade, "decisions", `${document.id}.json`));
    if (!record || !source) continue;
    documentsFiltered += 1; acts += record.acts.length; removedActs += record.filter.removed.length;
    supportedUngrounded += record.filter.supportedUngrounded; keptNoValidDecision += record.filter.keptNoValidDecision;
    unknownIds += record.filter.unknownIds.length;
    if (record.receipt) receipts.push(record.receipt);
    for (const { act: actId, reason } of record.filter.removed) {
      const act = record.acts.find(({ act: id }) => id === actId);
      const verdict = classifyRemoved(source, act, document, units, neutralUnits, options);
      removed[verdict] += 1;
      if (examples.filter((example) => example.verdict === verdict).length < 15) examples.push({ verdict, documentId: document.id,
        act: actId, label: act.view.map(({ label }) => label).filter(Boolean).join(" / ").slice(0, 160), reason });
    }
  }
  // The cascade consumes the astra-low arm: its latency per document is added from its receipts,
  // its API-equivalent cost is the published v101b figure (costs.md, same rate card).
  const astraLatency = [];
  for (const document of manifest.documents) {
    const astraReceipt = await readJsonIfPresent(join(resolve(repositoryRoot, SOURCE_DIR), `${document.id}--${sourceArm}.attempt-1.receipt.json`));
    const record = await readJsonIfPresent(join(cascade, "decisions", `${document.id}.json`));
    astraLatency.push({ astra: astraReceipt?.latency?.totalMs ?? null, gemini: record?.receipt?.latencyMs ?? 0 });
  }
  const costsMd = await readFile(resolve(repositoryRoot, "docs/reviews/refresh-benchmark/v101b/costs.md"), "utf8");
  const sourceTokens = armTokens(costsMd, sourceArm); const astraCost = sourceTokens?.apiUsd ?? NaN;
  const seat = seatFactors(JSON.parse(await readFile(resolve(repositoryRoot, "docs/reviews/refresh-benchmark/v101b/burn/seat-observations.json"), "utf8")).observations);
  const quantile = (values, q) => { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(q * sorted.length)] : null; };
  const passTokens = receipts.reduce((sum, { usage }) => sum + (usage ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.thoughtsTokenCount ?? 0) : 0), 0);
  const sums = astraLatency.map(({ astra, gemini }) => astra + gemini).filter(Number.isFinite);
  const meanSum = sums.length ? sums.reduce((a, b) => a + b, 0) / sums.length : null;
  const rate = RATE_CARDS["gemini-3.8-flash"];
  const cost = receipts.reduce((sum, { usage }) => sum + (usage ? apiCost(usage, rate) : 0), 0);
  const latencies = receipts.map(({ latencyMs }) => latencyMs).filter(Number.isFinite).sort((a, b) => a - b);
  const result = { generatedAt: new Date().toISOString(), network: "none", documentsFiltered,
    before: aggregate(before), after: aggregate(after), acts, removedActs, removed,
    supportedUngrounded, keptNoValidDecision, unknownIds,
    cost: { apiEquivalentUsd: cost, rate: { model: "gemini-3.8-flash", input: rate.input, output: rate.output, asOf: rate.asOf },
      calls: receipts.length, latencyMs: { p50: latencies[Math.floor(latencies.length / 2)] ?? null,
        p95: latencies[Math.floor(latencies.length * 0.95)] ?? null, max: latencies.at(-1) ?? null } },
    sourceArm, refusedSourceDocuments: refusedDocuments,
    cumulative: { sourceArm, astraLowApiUsd: Number.isFinite(astraCost) ? astraCost : null, geminiPassApiUsd: cost,
      totalApiUsd: Number.isFinite(astraCost) ? astraCost + cost : null, astraCostSource: "docs/reviews/refresh-benchmark/v101b/costs.md",
      tokens: { source: sourceTokens ? sourceTokens.input + sourceTokens.billableOutput : null, geminiPass: passTokens,
        total: sourceTokens ? sourceTokens.input + sourceTokens.billableOutput + passTokens : null },
      seatUsd: { source: Number.isFinite(astraCost) ? astraCost * seat.codex.factor : null,
        geminiPass: cost * seat.google.factor,
        total: Number.isFinite(astraCost) ? astraCost * seat.codex.factor + cost * seat.google.factor : null,
        factors: seat, method: "API cost x provider factor (report v10 section 8, cost-calculator api-cost-proportional)" },
      docsPerHourPerWorker: meanSum ? 3_600_000 / meanSum : null,
      latencyMsPerDocument: { astraLow: { p50: quantile(astraLatency.map(({ astra }) => astra), 0.5), p95: quantile(astraLatency.map(({ astra }) => astra), 0.95) },
        sum: { p50: quantile(astraLatency.map(({ astra, gemini }) => astra + gemini), 0.5), p95: quantile(astraLatency.map(({ astra, gemini }) => astra + gemini), 0.95) } } },
    removedExamples: examples };
  await writeFile(join(cascade, "mesures.json"), `${JSON.stringify(result, null, 1)}\n`);
  const lines = [`# ${config.arm} — mesures (référence oracle v3, stricte)`, "",
    `Documents filtrés : ${documentsFiltered}/100. Actes jugés : ${acts} ; retirés : ${removedActs}. Nature de l'acte retiré, au regard de la référence : faux (retrait justifié) ${removed.falseAct} ; juste (retrait erroné) ${removed.correctAct} ; non résolu ${removed.neutral}.`,
    `Coût en rappel : ${removed.correctAct} acte(s) juste(s) retiré(s) ; unités de la référence perdues (VP avant − après) : ${result.before.tp - result.after.tp}, soit ${pts(result.before.recall, result.after.recall)} points de rappel (un acte juste retiré ne coûte rien si un autre acte gardé couvre la même unité) ; gain en précision : ${pts(result.before.precision, result.after.precision)} points ; F1 : ${pts(result.before.f1, result.after.f1)} points (après − avant).`,
    `Contrôles : identifiants inconnus ignorés ${unknownIds} ; actes gardés faute de décision valide ${keptNoValidDecision} ; « soutenu » avec extrait non retrouvé ${supportedUngrounded}.`, "",
    "| | P | R | F1 | VP | FP | FN |", "|---|---:|---:|---:|---:|---:|---:|",
    `| ${sourceArm} seul | ${f(result.before.precision)} | ${f(result.before.recall)} | ${f(result.before.f1)} | ${result.before.tp} | ${result.before.fp} | ${result.before.fn} |`,
    `| après filtre gemini-low | ${f(result.after.precision)} | ${f(result.after.recall)} | ${f(result.after.f1)} | ${result.after.tp} | ${result.after.fp} | ${result.after.fn} |`, "",
    `Coût de la passe : ${receipts.length} appels, ${cost.toFixed(2)} USD d'équivalent API (tarif ${rate.asOf}), latence P50 ${seconds(result.cost.latencyMs.p50)} s, P95 ${seconds(result.cost.latencyMs.p95)} s.`,
    `Coût cumulé du bras ${config.arm.split(" ")[0]} (équivalent API) : ${sourceArm} ${result.cumulative.astraLowApiUsd?.toFixed(2) ?? "N-A"} USD + passe gemini-low ${cost.toFixed(2)} USD = ${result.cumulative.totalApiUsd?.toFixed(2) ?? "N-A"} USD sur 100 documents.`,
    `Coût cumulé en siège (coût API × facteur du fournisseur) : ${sourceArm} ${result.cumulative.astraLowApiUsd?.toFixed(2) ?? "N-A"} × facteur Codex ${seat.codex.factor.toFixed(6)} = ${result.cumulative.seatUsd.source?.toFixed(4) ?? "N-A"} USD + passe ${cost.toFixed(4)} × facteur Google ${seat.google.factor.toFixed(6)} = ${result.cumulative.seatUsd.geminiPass.toFixed(4)} USD ; total ${result.cumulative.seatUsd.total?.toFixed(4) ?? "N-A"} USD pour le passage de 100 documents.`,
    `Jetons cumulés : ${sourceArm} ${result.cumulative.tokens.source?.toLocaleString("fr-CA") ?? "N-A"} + passe ${passTokens.toLocaleString("fr-CA")} = ${result.cumulative.tokens.total?.toLocaleString("fr-CA") ?? "N-A"}.`,
    `Latence par document (somme ${sourceArm} + gemini-low, par document) : P50 ${seconds(result.cumulative.latencyMsPerDocument.sum.p50)} s, P95 ${seconds(result.cumulative.latencyMsPerDocument.sum.p95)} s (${sourceArm} seul : P50 ${seconds(result.cumulative.latencyMsPerDocument.astraLow.p50)} s, P95 ${seconds(result.cumulative.latencyMsPerDocument.astraLow.p95)} s) ; débit ${result.cumulative.docsPerHourPerWorker?.toFixed(1) ?? "N-A"} documents/heure par fil d'exécution (×4 en parallèle).`,
    ...(refusedDocuments.length ? [`Documents refusés par ${sourceArm} (aucune sortie à filtrer) : ${refusedDocuments.join(", ")} — notés comme le scoreur, toutes leurs unités en manqué, avant comme après le filtre : c'est une différence de couverture, pas de qualité du filtre.`] : []),
    "Limite à déclarer : la consigne du filtre porte la liste d'exclusions du corrigé (nominations, comptes, contrats de services, loisirs, voirie sans développement, dépôts de correspondance) ; la consigne d'extraction des bras (contrat immo-pv-extraction-v9) ne la porte pas. Une part du gain de précision vient de cet alignement sur les règles du corrigé, pas du seul fait de relire.",
    `Les quatre variantes (stricte, large, tolérante, souple) figurent dans \`oracle-v3/tableau-f1-100.md\`, ligne « ${config.arm.split(" ")[0]} ».`, ""];
  await writeFile(join(cascade, "mesures.md"), `${lines.join("\n")}\n`);
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const index = process.argv.indexOf("--source");
  const result = await report({ source: index > 0 ? process.argv[index + 1] : "astra-low" });
  console.log(JSON.stringify({ before: result.before.f1, after: result.after.f1, removed: result.removed, cost: result.cost.apiEquivalentUsd, cumulative: result.cumulative }));
}
