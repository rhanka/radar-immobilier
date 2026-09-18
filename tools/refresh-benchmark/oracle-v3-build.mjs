// Builds the oracle-v3 deliverables from the step outputs, offline (no model call):
//   consensus.json            final gold, only when every document has its 6 passes and its
//                             convergence votes; otherwise consensus-interim.json, marked interim
//   disputed.json             every dispute with its options, history, votes and resolution
//   grounding-rejects.json    rejected operations, counted per step and per code
//   volumes.json              per step: documents, operations applied, rejects, active units
//   calibration.json/.md      oracle v3 against the human gold v2 on the 5 hand-annotated documents
//
//   node tools/refresh-benchmark/oracle-v3-build.mjs [--out <dir>] [--chain astra,fable,gemini]

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { activeUnits, applyResolutions, CONVERGE_STEPS, disputesOf, goldUnit, ORACLE_V3_DIR,
  pairOneToOne, resolveVotes } from "./oracle-v3-lib.mjs";
import { chainSteps } from "./oracle-v3-step.mjs";

const readJsonIfPresent = async (path) => {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
};
const listJson = async (directory) => {
  try { return (await readdir(directory)).filter((name) => /^[^_].*(?<!\.receipt|\.error|\.parse-error)\.json$/u.test(name)); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
};
const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;
const round = (value) => value === null ? "N-A" : value.toFixed(3);
const PARTIAL_HUMAN = "waterloo-2026-08-18";

export async function build({ repositoryRoot = process.cwd(), out = ORACLE_V3_DIR,
  chain = ["astra", "fable", "gemini"] } = {}) {
  const outRoot = resolve(repositoryRoot, out);
  const benchmark = resolve(repositoryRoot, "docs/reviews/refresh-benchmark");
  const manifest = JSON.parse(await readFile(join(benchmark, "v101b/manifest.json"), "utf8"));
  const human = JSON.parse(await readFile(join(benchmark, "manual-oracle-v2.json"), "utf8"));
  const passSteps = chainSteps(chain);
  const fullChain = chain.join(",") === "astra,fable,gemini";

  // Volumes and grounding rejects, from the per-step annotation files.
  const volumes = {}; const rejects = []; const rejectCounts = {};
  for (const step of [...passSteps, ...CONVERGE_STEPS]) {
    const directory = join(outRoot, "annotations", step.id);
    const files = await listJson(directory);
    const volume = { documents: files.length, add: 0, remove: 0, correct: 0, rejected: 0,
      activeAfter: 0, votes: 0, noCall: 0, pageCorrected: 0, clipped: 0, anchorReplaced: 0,
      inputTokens: 0, outputTokens: 0, costUsd: 0, receipts: 0 };
    for (const name of files) {
      const record = JSON.parse(await readFile(join(directory, name), "utf8"));
      for (const { op } of record.applied ?? []) volume[op] += 1;
      volume.rejected += record.rejects?.length ?? 0; volume.activeAfter += record.activeAfter ?? 0;
      volume.votes += record.votes?.length ?? 0; volume.noCall += record.noCall ? 1 : 0;
      for (const flag of ["pageCorrected", "clipped", "anchorReplaced"]) volume[flag] += record.counters?.[flag] ?? 0;
      for (const reject of record.rejects ?? []) {
        rejects.push({ documentId: record.documentId, ...reject });
        rejectCounts[step.id] ??= {};
        rejectCounts[step.id][reject.code] = (rejectCounts[step.id][reject.code] ?? 0) + 1;
      }
      const receipt = await readJsonIfPresent(join(directory, name.replace(/\.json$/u, ".receipt.json")));
      if (receipt) {
        volume.receipts += 1;
        const usage = receipt.usage ?? {};
        volume.inputTokens += (usage.input_tokens ?? usage.inputTokens ?? 0)
          + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
        volume.outputTokens += usage.output_tokens ?? usage.outputTokens ?? 0;
        volume.costUsd += receipt.totalCostUsd ?? 0;
      }
    }
    volumes[step.id] = volume;
  }

  // Gold per document.
  const lastPass = passSteps.at(-1);
  const units = []; const disputed = []; const documentsStatus = [];
  for (const document of manifest.documents) {
    let state = null; let reached = null;
    for (const step of passSteps) {
      const candidate = await readJsonIfPresent(join(outRoot, "corrige", step.id, `${document.id}.json`));
      if (!candidate) break;
      state = candidate; reached = step.id;
    }
    const status = { documentId: document.id, lastPassStep: reached,
      passesComplete: reached === lastPass.id, convergence: "pending" };
    if (!state) { documentsStatus.push(status); continue; }
    const disputes = disputesOf(state);
    let finalState = state;
    if (status.passesComplete) {
      const votesByStep = {};
      for (const step of CONVERGE_STEPS) {
        votesByStep[step.family] = await readJsonIfPresent(join(outRoot, "annotations", step.id, `${document.id}.json`));
      }
      const complete = Object.values(votesByStep).every(Boolean);
      const stale = Object.values(votesByStep).some((record) => record
        && JSON.stringify(record.disputes?.map(({ unitId }) => unitId) ?? [])
          !== JSON.stringify(disputes.map(({ unitId }) => unitId)));
      if (stale) throw new Error(`convergence votes of ${document.id} do not match its current disputes`);
      status.convergence = disputes.length === 0 ? "none-needed" : complete ? "done" : "pending";
      const resolutions = {};
      for (const dispute of disputes) {
        const votes = Object.fromEntries(Object.entries(votesByStep).map(([family, record]) =>
          [family, record?.votes?.find((vote) => vote?.dispute === dispute.dispute) ?? null]));
        const resolution = complete ? resolveVotes(dispute, votes) : { outcome: "pending", choice: dispute.current, changed: false };
        resolutions[dispute.dispute] = resolution;
        disputed.push({ documentId: document.id, ...dispute, votes, resolution });
      }
      if (complete) finalState = applyResolutions(state, disputes, resolutions);
    } else {
      for (const dispute of disputes) disputed.push({ documentId: document.id, ...dispute,
        votes: null, resolution: { outcome: "pending", choice: dispute.current, changed: false } });
    }
    status.units = activeUnits(finalState).length;
    documentsStatus.push(status);
    for (const unit of activeUnits(finalState)) {
      const record = finalState.units.find(({ id }) => id === unit.id);
      units.push(goldUnit(unit, document, { addedBy: record.events[0].step,
        events: record.events.map(({ step, op }) => `${step}:${op}`) }));
    }
  }
  const final = fullChain && documentsStatus.every(({ passesComplete, convergence }) =>
    passesComplete && convergence !== "pending");
  const gold = { schemaVersion: 3, interim: !final, builtAt: new Date().toISOString(),
    method: "sequential: astra-pass1..2 -> fable-pass1..2 -> gemini-pass1..2 -> 3-model convergence vote (2 of 3)",
    chain, documents: manifest.documents.length,
    documentsWithGold: documentsStatus.filter(({ lastPassStep }) => lastPassStep).length,
    documentsComplete: documentsStatus.filter(({ passesComplete, convergence }) =>
      passesComplete && convergence !== "pending").length,
    unitCount: units.length, documentsStatus, rules: { R4: "stage_aliases: a unit's procedure (ppcmoi, usage_conditionnel, consultation_publique) is accepted as candidate stage" }, units };
  await writeFile(join(outRoot, final ? "consensus.json" : "consensus-interim.json"), `${JSON.stringify(gold, null, 1)}\n`);
  await writeFile(join(outRoot, "disputed.json"), `${JSON.stringify({ interim: !final, disputes: disputed.length,
    unresolved: disputed.filter(({ resolution }) => resolution.outcome === "unresolved").length,
    pending: disputed.filter(({ resolution }) => resolution.outcome === "pending").length,
    items: disputed }, null, 1)}\n`);
  await writeFile(join(outRoot, "grounding-rejects.json"), `${JSON.stringify({ total: rejects.length,
    byStep: rejectCounts, items: rejects }, null, 1)}\n`);
  await writeFile(join(outRoot, "volumes.json"), `${JSON.stringify(volumes, null, 1)}\n`);

  // Calibration against the human gold v2.
  const calibration = { interim: !final, documents: [] };
  let tp = 0; let humanTotal = 0; let v3Total = 0; let tpPrecision = 0;
  for (const document of manifest.documents.filter(({ manualOracle }) => manualOracle !== "N-A")) {
    const humans = human.units.filter(({ doc_sha: digest }) => digest === document.sha256);
    const candidates = units.filter(({ doc_sha: digest }) => digest === document.sha256);
    const status = documentsStatus.find(({ documentId }) => documentId === document.id);
    const { pairs, missed, added } = pairOneToOne(humans, candidates);
    const partial = document.id === PARTIAL_HUMAN;
    const available = Boolean(status?.lastPassStep);
    if (available) {
      tp += pairs.length; humanTotal += humans.length;
      if (!partial) { tpPrecision += pairs.length; v3Total += candidates.length; }
    }
    calibration.documents.push({ documentId: document.id, available, partialHuman: partial,
      human: humans.length, v3: candidates.length, matched: pairs.length,
      recall: available ? ratio(pairs.length, humans.length) : null,
      precision: available && !partial ? ratio(pairs.length, candidates.length) : null,
      pairs: pairs.map(([h, c]) => ({ human: h.id, v3: c.id, stage: h.stage, humanLabel: h.label, v3Label: c.label })),
      missed: missed.map(({ id, stage, label, page }) => ({ id, stage, label, page })),
      added: added.map(({ id, stage, label, page, citation }) => ({ id, stage, label, page, citation })) });
  }
  calibration.recall = ratio(tp, humanTotal); calibration.precision = ratio(tpPrecision, v3Total);
  calibration.humanUnitsCovered = humanTotal; calibration.note = `${PARTIAL_HUMAN}: human gold partial, precision N-A there`;
  await writeFile(join(outRoot, "calibration.json"), `${JSON.stringify(calibration, null, 1)}\n`);
  const lines = [`# Calibration — corrigé v3${final ? "" : " (INTÉRIMAIRE)"} contre corrigé humain v2`, "",
    "Erreur du corrigé lui-même, mesurée sur les 5 documents annotés à la main (36 unités humaines).",
    "Appariement : même document, même étape, et site verbatim partagé (ancre humaine dans la citation v3",
    "sur la même page, ou ancre v3 dans la citation humaine ou le texte d'un site alternatif). Un à un.",
    `Waterloo : corrigé humain partiel, précision N-A.`, "",
    `- Rappel du v3 sur l'humain : **${round(calibration.recall)}** (${tp}/${humanTotal} unités humaines des documents disponibles)`,
    `- Précision du v3 (4 documents complets) : **${round(calibration.precision)}** (${tpPrecision}/${v3Total} unités v3)`, "",
    "| Document | Humain | v3 | Appariées | Rappel | Précision |", "|---|---:|---:|---:|---:|---:|",
    ...calibration.documents.map((row) => `| ${row.documentId} | ${row.human} | ${row.available ? row.v3 : "N-A"} | ${row.available ? row.matched : "N-A"} | ${round(row.recall)} | ${round(row.precision)} |`),
    "", "## Unités humaines manquées par le v3", "",
    ...calibration.documents.flatMap((row) => row.missed.map((unit) => `- ${row.documentId} · ${unit.id} · ${unit.stage} · p.${unit.page} · ${unit.label}`)),
    "", "## Unités v3 absentes du corrigé humain", "",
    ...calibration.documents.flatMap((row) => row.added.map((unit) => `- ${row.documentId} · ${unit.id} · ${unit.stage} · p.${unit.page} · ${unit.label}`)), ""];
  await writeFile(join(outRoot, "calibration.md"), `${lines.join("\n")}\n`);
  return { final, units: units.length, disputes: disputed.length, rejects: rejects.length,
    calibration: { recall: calibration.recall, precision: calibration.precision } };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2); const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (args[index] === "--out") options.out = args[index + 1];
    else if (args[index] === "--chain") options.chain = args[index + 1].split(",");
    else throw new Error(`unknown flag ${args[index]}`);
  }
  console.log(JSON.stringify(await build(options)));
}
