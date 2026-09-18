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
import { readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { scoreValidV2 } from "./score-oracle-v2.mjs";
import { arms as v101Arms } from "./v101-arms.mjs";
import { ORACLE_V3_DIR } from "./oracle-v3-lib.mjs";

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
  if (found.state !== "accepted") return { tp: 0, fp: 0, fn: gold.length, accepted: false };
  const score = scoreValidV2(found.output, document, gold, options);
  return { tp: score.tp, fp: score.fp, fn: score.fn, accepted: true, from: found.from };
}

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

  const results = [];
  for (const source of armSources(v101b)) {
    const cases = []; const human4 = [];
    for (const document of manifest.documents) {
      const found = await resolveOutput(source, document.id);
      if (goldDocuments.has(document.id)) {
        const units = gold.units.filter(({ doc_sha: digest }) => digest === document.sha256);
        cases.push({ documentId: document.id, ...scoreCase(found, document, units,
          { useStageAliases: true, partialOracle: false }) });
      }
      if (humanDocuments.some(({ id }) => id === document.id)) {
        const units = human.units.filter(({ doc_sha: digest }) => digest === document.sha256);
        human4.push({ documentId: document.id, ...scoreCase(found, document, units, {}) });
      }
    }
    const net = aggregate(cases);
    const acceptedOnly = aggregate(cases.filter(({ accepted }) => accepted));
    const human4Net = aggregate(human4);
    const reference = published.get(source.arm);
    results.push({ arm: source.arm, kind: source.kind, documents: cases.length,
      accepted: cases.filter(({ accepted }) => accepted).length, net, acceptedOnly,
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
  const summary = { schemaVersion: 1, generatedAt: new Date().toISOString(), network: "none",
    gold: { path: relative(resolve(repositoryRoot), goldFile), sha256: sha256(goldBytes),
      interim: gold.interim !== false, units: gold.units.length, documents: goldDocuments.size },
    method: "net micro P/R/F1: refused or missing output = all gold units missed; scoreValidV2 with R1-R3 + R4 stage aliases, Waterloo scored as complete",
    arms: results };
  await writeFile(join(outRoot, "scores-100.json"), `${JSON.stringify(summary, null, 1)}\n`);
  const f = (value) => value === null || value === undefined ? "N-A" : value.toFixed(3);
  const signed = (value) => value === null ? "N-A" : `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;
  const lines = [`# F1 sur ${goldDocuments.size} documents — corrigé v3${summary.gold.interim ? " INTÉRIMAIRE" : ""}`, "",
    `Corrigé : \`${summary.gold.path}\` (${summary.gold.units} unités, sha256 ${summary.gold.sha256.slice(0, 12)}…).`,
    "P/R/F1 nets en micro : sortie refusée ou absente = toutes les unités du document manquées (aucun faux positif).",
    "« F1 4 doc publié » = `oracleV2AcceptedF1` de report-data.json (macro sur sorties acceptées, corrigé humain v2).",
    "« F1 4 doc net » = même méthode nette que ce tableau, sur le corrigé humain v2 (4 documents complets).", "",
    "| Rang | Bras | Acceptés | P net | R net | F1 net | F1 acceptés seuls | F1 4 doc publié | F1 4 doc net | Écart F1 net − publié |",
    "|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...results.map((row, index) => `| ${index + 1} | ${row.arm} | ${row.accepted}/${row.documents} | ${f(row.net.precision)} | ${f(row.net.recall)} | ${f(row.net.f1)} | ${f(row.acceptedOnly.f1)} | ${f(row.f1On4.publishedAcceptedMacro)} | ${f(row.f1On4.humanNetMicro)} | ${signed(row.deltaVs4)} |`),
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
