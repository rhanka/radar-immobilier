// Re-scores every v101b arm and the C2/C3 cascades on the 100 documents against oracle v3, from the
// archived outputs only (no model call). Extends score-oracle-v2.mjs (scoreValidV2 + R4 stage
// aliases, Waterloo no longer partial) instead of duplicating it.
//
// Net figures: a document whose output was refused or never produced scores tp=0, fp=0 and
// fn=|gold|, so an arm is judged on the 100 documents, not on the ones it got accepted.
//   C2  gemini-low; if refused, one gemini-low replay (replay-test attempt 1); then astra-low.
//   C3  same with a second replay (replay-test attempt 2) before astra-low.
// The reference "F1 sur 4 documents" is the published figure (report-data oracleV2AcceptedF1,
// macro over accepted outputs, human gold v2) plus the same net-micro method on the human gold.
//
//   node tools/refresh-benchmark/score-oracle-v3.mjs [--gold <path>] [--out <dir>]

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { scoreValidV2 } from "./score-oracle-v2.mjs";
import { arms as v101Arms } from "./v101-arms.mjs";
import { documentPages, locate, ORACLE_V3_DIR } from "./oracle-v3-lib.mjs";
import { CASCADES } from "./precision-cascade.mjs";
import { identifierInText, MIN_OVERLAP_CHARS, overlapChars, ROUGE_DIAGNOSTIC_THRESHOLD, rougeL, unitSpan } from "./oracle-v3-soft.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const readJsonIfPresent = async (path) => {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
};
const PARTIAL_HUMAN = "waterloo-2026-08-18";

// Latest attempt first, as the published comparison reads them (BENCHMARK_RETRY_NETWORK_TERMINAL=1
// order [4, 3, 2, 1]): the Anthropic arms carry network-terminal replays up to attempt 3.
async function acceptedOutput(directory, documentId, variant, attempts = [4, 3, 2, 1]) {
  for (const attempt of attempts) {
    const stem = join(directory, `${documentId}--${variant}.attempt-${attempt}`);
    const receipt = await readJsonIfPresent(`${stem}.receipt.json`);
    if (!receipt) continue;
    if (!receipt.validation?.accepted) return { state: "refused", attempt };
    const output = await readJsonIfPresent(`${stem}.output.json`);
    return output ? { state: "accepted", attempt, output } : { state: "refused", attempt };
  }
  return { state: "not_launched" };
}

const repositoryRootOf = (v101b) => resolve(v101b, "../../../..");
export function armSources(v101b) {
  const direct = (variant) => ({ label: variant, directory: v101Arms[variant].lane === "codex"
    ? join(v101b, "codex-replay/campaign", variant) : join(v101b, "campaign", variant), variant });
  const sources = Object.keys(v101Arms).map((variant) => ({ arm: variant, kind: "arm", chain: [direct(variant)] }));
  const replay = (attempt) => ({ label: `gemini-low replay ${attempt}`,
    directory: join(v101b, "replay-test/campaign/gemini-low"), variant: "gemini-low", attempts: [attempt] });
  sources.push({ arm: "C2 (gemini-low x2 -> astra-low)", kind: "cascade",
    chain: [direct("gemini-low"), replay(1), direct("astra-low")] });
  sources.push({ arm: "C3 (gemini-low x3 -> astra-low)", kind: "cascade",
    chain: [direct("gemini-low"), replay(1), replay(2), direct("astra-low")] });
  // Precision cascade (owner request 2026-09-18): astra-low outputs filtered by a gemini-low
  // re-read (precision-cascade.mjs). Present once the pass has run.
  // Only the reference cascade is scored in the report table (owner decision 2026-09-19):
  // CP = astra-medium -> gemini 3.8 low. The astra-low cascade stays on disk with its own measures.
  for (const [from, cascade] of Object.entries(CASCADES).filter(([, value]) => value.inReport)) {
    const precisionDir = join(repositoryRootOf(v101b), cascade.dir, "campaign");
    if (existsSync(precisionDir)) sources.push({ arm: cascade.arm, kind: "precision-cascade",
      chain: [{ label: `${from} filtré par gemini-low`, directory: precisionDir, variant: cascade.variant, attempts: [1] }] });
  }
  return sources;
}

export async function resolveOutput(source, documentId) {
  for (const step of source.chain) {
    const found = await acceptedOutput(step.directory, documentId, step.variant, step.attempts);
    if (found.state === "accepted") return { ...found, from: step.label };
  }
  return { state: "refused_or_missing" };
}

export function aggregate(cases) {
  const total = cases.reduce((sum, entry) => ({ tp: sum.tp + entry.tp, fp: sum.fp + entry.fp,
    fn: sum.fn + entry.fn }), { tp: 0, fp: 0, fn: 0 });
  const precision = total.tp + total.fp ? total.tp / (total.tp + total.fp) : null;
  const recall = total.tp + total.fn ? total.tp / (total.tp + total.fn) : null;
  const f1 = 2 * total.tp + total.fp + total.fn ? 2 * total.tp / (2 * total.tp + total.fp + total.fn) : null;
  return { ...total, precision, recall, f1 };
}

// One document: refused/missing counts as all gold missed, nothing claimed.
export function scoreCase(found, document, gold, options) {
  if (found.state !== "accepted") return { tp: 0, fp: 0, fn: gold.length, accepted: false, neutralized: 0, softOnly: 0 };
  const score = scoreValidV2(found.output, document, gold, options);
  return { tp: score.tp, fp: score.fp, fn: score.fn, accepted: true, from: found.from,
    neutralized: score.neutralizedGroups ?? 0, softOnly: score.softMatchedIds?.length ?? 0,
    softIds: (score.softMatchedIds ?? []).map((id) => `${document.id}:${id}`) };
}

// Bounds on the unresolved items (owner request 2026-09-18):
//   strict  reference = unanimous or resolved units; each unresolved item is NEUTRAL: not expected,
//           and a candidate matching it is not a false detection either;
//   broad   each unresolved item is an expected unit (credited if any of its versions is found,
//           missed otherwise).
// Separate columns, never mixed into the strict figure: stage-tolerant (R5, same anchored site,
// any stage) and soft (character intervals: same page, same stage, object key found exactly in the
// output's own text, the output excerpt and the gold citation overlapping by >= 12 normalised
// characters; one unit per detection). A ROUGE-L column (>= 0.5, same conditions otherwise) is a
// diagnostic only.
export function unresolvedUnits(entries) {
  return entries.map((entry) => ({ id: `${entry.documentId}#${entry.item}`, documentId: entry.documentId,
    variants: entry.options.filter(({ unit }) => unit).map(({ unit }) => ({ stage: unit.stage,
      ...(unit.procedure ? { stage_aliases: [unit.procedure] } : {}), page: unit.page, anchor: unit.anchor,
      citation: unit.citation, objet: unit.objet })) })).filter(({ variants }) => variants.length > 0);
}

export function softMatcherFor(pages, rule = "intervals") {
  if (!pages) return null;
  return (unit, { stages, records, texts }) => {
    const unitStages = [unit.stage, ...(unit.stage_aliases ?? [])];
    if (!unitStages.some((stage) => stages.has(stage))) return false;
    if (!identifierInText(unit, texts)) return false;
    const pageText = pages[unit.page - 1];
    if (typeof pageText !== "string") return false;
    const goldSpan = unitSpan(unit, pages);
    return records.some((record) => {
      if (record.page !== unit.page || typeof record.excerpt !== "string") return false;
      if (rule === "rouge") return rougeL(record.excerpt, unit.citation) >= ROUGE_DIAGNOSTIC_THRESHOLD;
      return overlapChars(pageText, locate(pageText, record.excerpt), goldSpan) >= MIN_OVERLAP_CHARS;
    });
  };
}

const rankOf = (rows, pick) => new Map([...rows].sort((a, b) => (pick(b) ?? -1) - (pick(a) ?? -1))
  .map((row, index) => [row.arm, index + 1]));

export async function scoreAll({ repositoryRoot = process.cwd(), goldPath = null, out = ORACLE_V3_DIR } = {}) {
  const benchmark = resolve(repositoryRoot, "docs/reviews/refresh-benchmark");
  const v101b = join(benchmark, "v101b");
  const outRoot = resolve(repositoryRoot, out);
  const manifest = JSON.parse(await readFile(join(v101b, "manifest.json"), "utf8"));
  const goldFile = goldPath ? resolve(repositoryRoot, goldPath)
    : await readJsonIfPresent(join(outRoot, "consensus.json")) ? join(outRoot, "consensus.json")
      : join(outRoot, "consensus-interim.json");
  const goldBytes = await readFile(goldFile);
  const gold = JSON.parse(goldBytes.toString("utf8"));
  const human = JSON.parse(await readFile(join(benchmark, "manual-oracle-v2.json"), "utf8"));
  const report = JSON.parse(await readFile(join(v101b, "report-data.json"), "utf8"));
  const published = new Map(report.arms.map((arm) => [arm.arm, arm]));
  const goldDocuments = new Set(gold.documentsStatus?.filter(({ lastPassStep }) => lastPassStep)
    .map(({ documentId }) => documentId) ?? manifest.documents.map(({ id }) => id));
  const humanDocuments = manifest.documents.filter(({ manualOracle, id }) => manualOracle !== "N-A" && id !== PARTIAL_HUMAN);
  const unresolvedFile = await readJsonIfPresent(join(outRoot, "unresolved.json"));
  const disputedFile = await readJsonIfPresent(join(outRoot, "disputed.json"));
  const pendingEntries = (disputedFile?.entries ?? []).filter(({ resolution }) => resolution?.outcome === "pending");
  const neutral = unresolvedUnits([...(unresolvedFile?.entries ?? []), ...pendingEntries]);
  const pagesOf = new Map();
  const pagesFor = async (document) => {
    if (!pagesOf.has(document.id)) pagesOf.set(document.id,
      documentPages(await readFile(resolve(repositoryRoot, document.runtimeTextRelativePath), "utf8")));
    return pagesOf.get(document.id);
  };
  const base = { useStageAliases: true, partialOracle: false };

  const results = [];
  for (const source of armSources(v101b)) {
    const cases = []; const human4 = []; const broad = []; const tolerant = []; const soft = []; const rouge = [];
    for (const document of manifest.documents) {
      const found = await resolveOutput(source, document.id);
      if (goldDocuments.has(document.id)) {
        const units = gold.units.filter(({ doc_sha: digest }) => digest === document.sha256);
        const neutralUnits = neutral.filter(({ documentId }) => documentId === document.id);
        cases.push({ documentId: document.id, ...scoreCase(found, document, units, { ...base, neutralUnits }) });
        broad.push(scoreCase(found, document, [...units, ...neutralUnits], base));
        tolerant.push(scoreCase(found, document, units, { ...base, neutralUnits, stageTolerant: true }));
        const pages = await pagesFor(document);
        soft.push(scoreCase(found, document, units, { ...base, neutralUnits, softMatcher: softMatcherFor(pages) }));
        rouge.push(scoreCase(found, document, units, { ...base, neutralUnits, softMatcher: softMatcherFor(pages, "rouge") }));
      }
      if (humanDocuments.some(({ id }) => id === document.id)) {
        const units = human.units.filter(({ doc_sha: digest }) => digest === document.sha256);
        human4.push({ documentId: document.id, ...scoreCase(found, document, units, {}) });
      }
    }
    const net = aggregate(cases);
    const broadNet = aggregate(broad); const tolerantNet = aggregate(tolerant);
    const softNet = aggregate(soft); const rougeNet = aggregate(rouge);
    const softIds = new Set(soft.flatMap(({ softIds: ids }) => ids ?? []));
    const rougeIds = new Set(rouge.flatMap(({ softIds: ids }) => ids ?? []));
    const acceptedOnly = aggregate(cases.filter(({ accepted }) => accepted));
    const human4Net = aggregate(human4);
    const reference = published.get(source.arm);
    results.push({ arm: source.arm, kind: source.kind, documents: cases.length,
      accepted: cases.filter(({ accepted }) => accepted).length, net, strict: net, broad: broadNet,
      deltaBroadMinusStrict: net.f1 !== null && broadNet.f1 !== null ? broadNet.f1 - net.f1 : null,
      neutralizedDetections: cases.reduce((sum, { neutralized }) => sum + (neutralized ?? 0), 0),
      stageTolerant: { ...tolerantNet, addedMatches: tolerantNet.tp - net.tp },
      soft: { ...softNet, addedMatches: softNet.tp - net.tp, softOnlyMatches: softIds.size },
      rougeDiagnostic: { ...rougeNet, addedMatches: rougeNet.tp - net.tp, softOnlyMatches: rougeIds.size,
        both: [...softIds].filter((id) => rougeIds.has(id)).length,
        intervalsOnly: [...softIds].filter((id) => !rougeIds.has(id)).length,
        rougeOnly: [...rougeIds].filter((id) => !softIds.has(id)).length },
      acceptedOnly,
      acceptedFrom: source.kind === "cascade" ? Object.fromEntries(source.chain.map(({ label }) =>
        [label, cases.filter(({ from }) => from === label).length])) : undefined,
      f1On4: { publishedAcceptedMacro: reference?.oracleV2AcceptedF1 ?? null,
        publishedAcceptanceAdjusted: reference?.oracleV2AcceptanceAdjustedF1 ?? null,
        humanNetMicro: human4Net.f1, humanNet: human4Net },
      deltaVs4: net.f1 !== null && reference?.oracleV2AcceptedF1 != null
        ? net.f1 - reference.oracleV2AcceptedF1 : null,
      cases });
  }
  results.sort((a, b) => (b.net.f1 ?? -1) - (a.net.f1 ?? -1));
  const strictRank = rankOf(results, (row) => row.strict.f1); const broadRank = rankOf(results, (row) => row.broad.f1);
  for (const row of results) { row.rankStrict = strictRank.get(row.arm); row.rankBroad = broadRank.get(row.arm); }
  const bounds = { unresolvedItems: neutral.length,
    armsChangingRank: results.filter(({ rankStrict, rankBroad }) => rankStrict !== rankBroad).length,
    softRule: `character intervals >= ${MIN_OVERLAP_CHARS} normalised characters; ROUGE-L >= ${ROUGE_DIAGNOSTIC_THRESHOLD} diagnostic only`,
    stageTolerantAddedMatches: results.reduce((sum, row) => sum + row.stageTolerant.addedMatches, 0),
    softAddedMatches: results.reduce((sum, row) => sum + row.soft.addedMatches, 0),
    rougeDiagnosticAddedMatches: results.reduce((sum, row) => sum + row.rougeDiagnostic.addedMatches, 0),
    softVsRouge: { both: results.reduce((sum, row) => sum + row.rougeDiagnostic.both, 0),
      intervalsOnly: results.reduce((sum, row) => sum + row.rougeDiagnostic.intervalsOnly, 0),
      rougeOnly: results.reduce((sum, row) => sum + row.rougeDiagnostic.rougeOnly, 0) } };
  const summary = { schemaVersion: 1, generatedAt: new Date().toISOString(), network: "none",
    gold: { path: relative(resolve(repositoryRoot), goldFile), sha256: sha256(goldBytes),
      interim: gold.interim !== false, units: gold.units.length, documents: goldDocuments.size },
    method: "net micro P/R/F1: refused or missing output = all gold units missed; scoreValidV2 with R1-R3 + R4 stage aliases, Waterloo scored as complete. strict = unresolved items neutral (not expected, not false detections); broad = unresolved items expected; stage-tolerant (R5) and soft (ROUGE-L) are separate columns, never mixed into strict",
    bounds, arms: results };
  await writeFile(join(outRoot, "scores-100.json"), `${JSON.stringify(summary, null, 1)}\n`);
  const f = (value) => value === null || value === undefined ? "N-A" : value.toFixed(3);
  const signed = (value) => value === null ? "N-A" : `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;
  const lines = [`# F1 sur ${goldDocuments.size} documents — corrigé v3${summary.gold.interim ? " INTÉRIMAIRE" : ""}`, "",
    `Corrigé : \`${summary.gold.path}\` (${summary.gold.units} unités, sha256 ${summary.gold.sha256.slice(0, 12)}…).`,
    "P/R/F1 nets en micro : sortie refusée ou absente = toutes les unités du document manquées (aucun faux positif).",
    "« F1 4 doc publié » = `oracleV2AcceptedF1` de report-data.json (macro sur sorties acceptées, corrigé humain v2).",
    "",
    `Bornes : ${bounds.unresolvedItems} éléments non résolus ; stricte = neutralisés (ni attendus, ni fausses détections), large = attendus. ${bounds.armsChangingRank} bras changent de rang entre stricte et large.`,
    `Colonnes séparées, jamais mélangées à la stricte : tolérante à l'étape (même site ancré, toute étape, une unité par détection ; +${bounds.stageTolerantAddedMatches} correspondances au total) et souple par intervalles (même page, même étape, identifiant exact, recouvrement ≥ ${MIN_OVERLAP_CHARS} caractères normalisés, une unité par détection ; +${bounds.softAddedMatches} au total).`,
    `Diagnostic ROUGE-L ≥ ${ROUGE_DIAGNOSTIC_THRESHOLD} (mêmes conditions, ne crédite rien) : +${bounds.rougeDiagnosticAddedMatches} au total ; unités rapprochées par les deux méthodes ${bounds.softVsRouge.both}, par les intervalles seuls ${bounds.softVsRouge.intervalsOnly}, par ROUGE-L seul ${bounds.softVsRouge.rougeOnly} — ces dernières sont celles que l'avis Fable décrit comme majoritairement fausses (numéros voisins), raison pour laquelle ROUGE-L ne crédite rien.`, "",
    "| Rang | Bras | Acceptés | P stricte | R stricte | F1 stricte | P large | R large | F1 large | Δ F1 large − stricte | Rang large | F1 tolérante étape (+corr.) | F1 souple intervalles (+corr.) | ROUGE-L diag. (+corr.) | F1 4 doc publié |",
    "|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...results.map((row, index) => `| ${index + 1} | ${row.arm} | ${row.accepted}/${row.documents} | ${f(row.strict.precision)} | ${f(row.strict.recall)} | ${f(row.strict.f1)} | ${f(row.broad.precision)} | ${f(row.broad.recall)} | ${f(row.broad.f1)} | ${signed(row.deltaBroadMinusStrict)} | ${row.rankBroad} | ${f(row.stageTolerant.f1)} (+${row.stageTolerant.addedMatches}) | ${f(row.soft.f1)} (+${row.soft.addedMatches}) | ${f(row.rougeDiagnostic.f1)} (+${row.rougeDiagnostic.addedMatches}) | ${f(row.f1On4.publishedAcceptedMacro)} |`),
    "", "Cascades (origine des sorties acceptées) :", "",
    ...results.filter(({ kind }) => kind === "cascade").map((row) => `- ${row.arm} : ${Object.entries(row.acceptedFrom).map(([label, count]) => `${label} ${count}`).join(" · ")}`), ""];
  await writeFile(join(outRoot, "tableau-f1-100.md"), `${lines.join("\n")}\n`);
  return summary;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2); const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (args[index] === "--gold") options.goldPath = args[index + 1];
    else if (args[index] === "--out") options.out = args[index + 1];
    else throw new Error(`unknown flag ${args[index]}`);
  }
  const summary = await scoreAll(options);
  console.log(JSON.stringify(summary.arms.slice(0, 8).map(({ arm, accepted, net }) =>
    ({ arm, accepted, f1: net.f1 === null ? null : Number(net.f1.toFixed(3)) }))));
}
