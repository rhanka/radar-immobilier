// bench-v11: score selected sources against oracle 676, reusing the exact
// v10 matching code (scoreValidV2 + R4 aliases, neutral/broad bounds,
// stage-tolerant + soft columns). Sources without committed same-transport
// outputs are NOT scored here (see SUMMARY for the carried-674 table).
// Usage: node score-676.mjs  (writes full/rescore-v10/scores-676.json)
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const DIR = "/home/antoinefa/src/radar-immobilier-bench/tmp/bench-wonder";
const H = `${DIR}/harness`;
const { scoreValidV2 } = await import(`${H}/score-oracle-v2.mjs`);
const { unresolvedUnits, softMatcherFor, aggregate, scoreCase } = await import(`${H}/score-oracle-v3.mjs`);
const { documentPages } = await import(`${H}/o3l.mjs`);
const { CASCADES } = await import(`${H}/precision-cascade.mjs`);

const manifest = JSON.parse(await readFile(`${H}/manifest-v101b.json`, "utf8"));
const gold = JSON.parse(await readFile(`${DIR}/full/oracle-676/consensus.json`, "utf8"));
const unresolved = JSON.parse(await readFile(`${DIR}/full/oracle-676/unresolved.json`, "utf8"));
const human = JSON.parse(await readFile(`${H}/manual-oracle-v2.json`, "utf8"));
const neutral = unresolvedUnits(unresolved.entries);
const humanDocs = new Set(manifest.documents.filter(({ manualOracle, id }) =>
  manualOracle !== "N-A" && id !== "waterloo-2026-08-18").map(({ id }) => id));

const pageCache = new Map();
const pagesFor = async (document) => {
  if (!pageCache.has(document.id)) pageCache.set(document.id,
    documentPages(await readFile(`${DIR}/full/corpus/text/${document.id}.txt`, "utf8")));
  return pageCache.get(document.id);
};
const readJsonIfPresent = async (path) => {
  try { return JSON.parse(await readFile(path, "utf8")); } catch (e) {
    if (e.code === "ENOENT") return null; throw e;
  }
};
const base = { useStageAliases: true, partialOracle: false };

export async function scoreSource(arm, kind, resolveDoc) {
  const cases = []; const broad = []; const tolerant = []; const soft = []; const human4 = [];
  for (const document of manifest.documents) {
    const found = await resolveDoc(document.id);
    const units = gold.units.filter(({ doc_sha: digest }) => digest === document.sha256);
    const neutralUnits = neutral.filter(({ documentId }) => documentId === document.id);
    cases.push({ documentId: document.id, ...scoreCase(found, document, units, { ...base, neutralUnits }) });
    broad.push(scoreCase(found, document, [...units, ...neutralUnits], base));
    tolerant.push(scoreCase(found, document, units, { ...base, neutralUnits, stageTolerant: true }));
    const pages = await pagesFor(document);
    soft.push(scoreCase(found, document, units, { ...base, neutralUnits, softMatcher: softMatcherFor(pages) }));
    if (humanDocs.has(document.id)) {
      const hunits = human.units.filter(({ doc_sha: digest }) => digest === document.sha256);
      human4.push({ documentId: document.id, ...scoreCase(found, document, hunits, {}) });
    }
  }
  const net = aggregate(cases);
  const broadNet = aggregate(broad);
  const tolerantNet = aggregate(tolerant);
  const softNet = aggregate(soft);
  return { arm, kind, documents: cases.length, accepted: cases.filter((c) => c.accepted).length,
    net, strict: net, broad: broadNet,
    deltaBroadMinusStrict: net.f1 !== null && broadNet.f1 !== null ? broadNet.f1 - net.f1 : null,
    stageTolerant: { ...tolerantNet, addedMatches: tolerantNet.tp - net.tp },
    soft: { ...softNet, addedMatches: softNet.tp - net.tp },
    human4: aggregate(human4), cases };
}

// v10 cascade outputs, checked out from the bench branch under rescore-v10/v101b/.
const V10 = `${DIR}/full/rescore-v10`;
const cascadeSource = (dir, variant) => async (documentId) => {
  const receipt = await readJsonIfPresent(
    `${V10}/${dir}/campaign/${documentId}--${variant}.attempt-1.receipt.json`);
  if (!receipt) return { state: "not_launched" };
  if (!receipt.validation?.accepted) return { state: "refused" };
  const output = await readJsonIfPresent(
    `${V10}/${dir}/campaign/${documentId}--${variant}.attempt-1.output.json`);
  return output ? { state: "accepted", output } : { state: "refused" };
};

import { pathToFileURL } from "node:url";
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const only = process.argv[2] ?? null;
  const results = [];
  const targets = [
    ["CP (astra-medium → vérification gemini-3.8 low, cascade de précision)", "precision-cascade",
      cascadeSource(CASCADES["astra-medium"].dir, CASCADES["astra-medium"].variant)],
    ["CP-low (astra-low → vérification gemini-3.8 low ; première cascade, hors rapport)", "precision-cascade",
      cascadeSource(CASCADES["astra-low"].dir, CASCADES["astra-low"].variant)],
  ].filter(([arm]) => !only || arm === only);
  for (const [arm, kind, resolveDoc] of targets) {
    results.push(await scoreSource(arm, kind, resolveDoc));
  }
  await mkdir(`${DIR}/full/rescore-v10`, { recursive: true });
  await writeFile(`${DIR}/full/rescore-v10/scores-676.json`,
    JSON.stringify({ gold: { units: gold.units.length, unresolved: unresolved.count },
      arms: results.map(({ cases, ...rest }) => rest),
      cases: Object.fromEntries(results.map((r) => [r.arm, r.cases])) }, null, 1));
  for (const r of results) {
    console.log(`${r.arm}: accepted=${r.accepted} P=${r.net.precision?.toFixed(3)} R=${r.net.recall?.toFixed(3)} F1=${r.net.f1?.toFixed(3)}`);
  }
}
