// Builds the oracle-v3 deliverables from the step outputs, offline (no model call):
//   consensus.json            final reference, only when every document has its 6 passes, its 3
//                             verifications and its arbitration; otherwise consensus-interim.json
//   rapport-reference.md      unanimous / arbitrated / unresolved counts, human differences by cause
//   disputed.json             every arbitrated item: options, excerpts, positions, votes, resolution
//   unresolved.json           items still without unanimity after arbitration, for the owner
//   human-diffs.json          every difference with the human gold v2 and its verdict
//   grounding-rejects.json    rejected operations, counted per step and per code
//   volumes.json              per step: documents, operations applied, rejects, active units
//   calibration.json/.md      oracle v3 against the human gold v2 on the 5 hand-annotated documents
//
//   node tools/refresh-benchmark/oracle-v3-build.mjs [--out <dir>] [--chain astra,fable,gemini]

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { activeUnits, ARBITRATE_STEPS, ARCHIVED_STEPS, CONVERGE_STEPS, documentPages, goldUnit, ORACLE_V3_DIR,
  pairOneToOne } from "./oracle-v3-lib.mjs";
import { chainSteps, documentLineage, humanUnitsByDocument, PARTIAL_HUMAN } from "./oracle-v3-step.mjs";
import { arbitrationItemsOf, FAMILY_ORDER, finalUnits, humanVerdict, reviewItemsOf, verificationOutcome } from "./oracle-v3-verdict.mjs";
import { distribution, MIN_OVERLAP_CHARS, ROUGE_DIAGNOSTIC_THRESHOLD, rougeL, sameIdentity, spanOverlap } from "./oracle-v3-soft.mjs";

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
// What the reader must know about each annex before reading it (conductor's notes).
const ANNEX_NOTES = Object.freeze({
  "ROUGE_L_AVIS_ASTRA.md": "texte abrégé : la génération s'est arrêtée avant la fin et le conducteur a retiré des liens vers des chemins absolus de la machine ; raisonnement et recommandation présents, fin du paragraphe proposé tronquée.",
  "ROUGE_L_AVIS_FABLE.md": "texte complet.",
});

export async function build({ repositoryRoot = process.cwd(), out = ORACLE_V3_DIR,
  chain = ["astra", "fable", "gemini"] } = {}) {
  const outRoot = resolve(repositoryRoot, out);
  const benchmark = resolve(repositoryRoot, "docs/reviews/refresh-benchmark");
  const manifest = JSON.parse(await readFile(join(benchmark, "v101b/manifest.json"), "utf8"));
  const passSteps = chainSteps(chain);
  const fullChain = chain.join(",") === "astra,fable,gemini";

  // Volumes and grounding rejects, from the per-step annotation files.
  const volumes = {}; const rejects = []; const rejectCounts = {};
  for (const step of [...passSteps, ...ARCHIVED_STEPS, ...CONVERGE_STEPS, ...ARBITRATE_STEPS]) {
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

  // Reference per document: passes -> verification (unanimity) -> arbitration.
  const humanByDocument = await humanUnitsByDocument(repositoryRoot, manifest.documents);
  // Soft-matching diagnostics (intervals decide, ROUGE-L is only reported): every pair of distinct
  // versions of one unit with the same identity, and every pair of distinct ACTIVE units (state after
  // the last pass) with the same identity on the same page (the pairs a text score could wrongly join).
  const softPairs = { sameUnitVersions: [], distinctUnits: [] };
  const units = []; const disputed = []; const unresolved = []; const humanDiffs = []; const documentsStatus = [];
  const counts = { items: 0, unanimousPresent: 0, unanimousAbsent: 0, softMerged: 0, arbitrated: 0,
    arbitratedPresent: 0, arbitratedAbsent: 0, unresolved: 0, pending: 0,
    softMergedArbitrationAgreed: 0, softMergedArbitrationDiffered: 0, rougeWouldMerge: 0,
    intervalOnlyMerges: 0, rougeOnlyMerges: 0 };
  for (const document of manifest.documents) {
    const lineage = await documentLineage(outRoot, document.id);
    const reached = lineage.at(-1) ?? null;
    const state = reached ? await readJsonIfPresent(join(outRoot, "corrige", reached, `${document.id}.json`)) : null;
    const status = { documentId: document.id, lastPassStep: reached, lineage,
      passesComplete: passSteps.every(({ id }) => lineage.includes(id)),
      verification: "pending", arbitration: "pending" };
    documentsStatus.push(status);
    if (!state) continue;
    const pushUnit = (unit, provenance) => units.push(goldUnit(unit, document, provenance));
    const records = {}; const arbitrationRecords = {};
    for (const family of FAMILY_ORDER) {
      records[family] = status.passesComplete ? await readJsonIfPresent(join(outRoot, "annotations", `converge-${family}`, `${document.id}.json`)) : null;
      arbitrationRecords[family] = await readJsonIfPresent(join(outRoot, "annotations", `arbitrate-${family}`, `${document.id}.json`));
    }
    const verificationDone = FAMILY_ORDER.every((family) => records[family]);
    if (!verificationDone) {
      // Interim: the gold after the passes, not verified.
      for (const unit of activeUnits(state)) {
        const record = state.units.find(({ id }) => id === unit.id);
        pushUnit(unit, { via: "passes-unverified", addedBy: record.events[0].step,
          events: record.events.map(({ step, op }) => `${step}:${op}`) });
      }
      status.units = activeUnits(state).length;
      continue;
    }
    const expected = reviewItemsOf(state).map(({ item, unitId }) => `${item}:${unitId}`).join(",");
    for (const family of FAMILY_ORDER) {
      const got = (records[family].items ?? []).map(({ item, unitId }) => `${item}:${unitId}`).join(",");
      if (got !== expected) throw new Error(`converge-${family}/${document.id}: verified items do not match the current gold`);
    }
    status.verification = "done";
    const pages = documentPages(await readFile(resolve(repositoryRoot, document.runtimeTextRelativePath), "utf8"));
    for (const unit of state.units) {
      const versions = [...new Map(unit.versions.map(({ unit: version }) => [version.citation, version])).values()];
      for (let a = 0; a < versions.length; a += 1) for (let b = a + 1; b < versions.length; b += 1) {
        if (!sameIdentity(versions[a], versions[b])) continue;
        softPairs.sameUnitVersions.push({ documentId: document.id, unitId: unit.id, page: [versions[a].page, versions[b].page],
          overlapChars: spanOverlap(versions[a], versions[b], pages), rougeL: rougeL(versions[a].citation, versions[b].citation),
          citations: [versions[a].citation, versions[b].citation] });
      }
    }
    const activeState = state.units.filter(({ status }) => status === "active");
    for (let a = 0; a < activeState.length; a += 1) for (let b = a + 1; b < activeState.length; b += 1) {
      const [left, right] = [activeState[a].current, activeState[b].current];
      if (!sameIdentity(left, right) || left.page !== right.page) continue;
      softPairs.distinctUnits.push({ documentId: document.id, unitIds: [activeState[a].id, activeState[b].id], page: left.page,
        overlapChars: spanOverlap(left, right, pages), rougeL: rougeL(left.citation, right.citation), citations: [left.citation, right.citation] });
    }
    const arbitration = arbitrationItemsOf({ documentId: document.id, pages, state, records,
      humans: humanByDocument.get(document.id) ?? [], partialHuman: document.id === PARTIAL_HUMAN });
    for (const family of FAMILY_ORDER) {
      const record = arbitrationRecords[family];
      if (record && JSON.stringify((record.items ?? []).map(({ item, kind, unitId, humanId }) => [item, kind, unitId ?? null, humanId ?? null]))
        !== JSON.stringify(arbitration.map(({ item, kind, unitId, humanId }) => [item, kind, unitId ?? null, humanId ?? null]))) {
        throw new Error(`arbitrate-${family}/${document.id}: arbitration items do not match the verification`);
      }
    }
    const { units: kept, verified, decisions } = finalUnits({ state, records, arbitration, arbitrationRecords, pages });
    status.arbitration = decisions.length === 0 ? "none-needed"
      : decisions.some(({ resolution }) => resolution.outcome === "pending") ? "pending" : "done";
    counts.items += verified.length;
    for (const entry of verified) {
      if (entry.result.outcome !== "unanimous") continue;
      if (entry.result.choice === "absent") counts.unanimousAbsent += 1; else counts.unanimousPresent += 1;
    }
    for (const decision of decisions) {
      const outcome = decision.resolution.outcome;
      if (decision.softDiagnostics) {
        const { intervalMerge, rougeMerge } = decision.softDiagnostics;
        if (rougeMerge) counts.rougeWouldMerge += 1;
        if (intervalMerge && !rougeMerge) counts.intervalOnlyMerges += 1;
        if (rougeMerge && !intervalMerge) counts.rougeOnlyMerges += 1;
      }
      if (outcome === "merged") {
        counts.softMerged += 1;
        const cross = decision.resolution.arbitration;
        if (cross?.outcome === "resolved") {
          if (cross.choice === decision.resolution.choice) counts.softMergedArbitrationAgreed += 1;
          else counts.softMergedArbitrationDiffered += 1;
        }
      } else if (outcome === "resolved") {
        counts.arbitrated += 1;
        if (decision.resolution.choice === "absent") counts.arbitratedAbsent += 1; else counts.arbitratedPresent += 1;
      } else counts[outcome === "pending" ? "pending" : "unresolved"] += 1;
      const entry = { documentId: document.id, ...decision,
        excerpts: decision.options.filter(({ unit }) => unit).map(({ option, unit }) => ({ option, page: unit.page, citation: unit.citation })) };
      disputed.push(entry);
      if (outcome === "unresolved") unresolved.push(entry);
      const verdict = humanVerdict(decision);
      const agreesWithHuman = decision.kind === "split" && ["resolved", "merged"].includes(decision.resolution.outcome)
        && decision.resolution.choice === decision.human?.choice;
      if (verdict && !agreesWithHuman) {
        humanDiffs.push({ documentId: document.id, item: decision.item, kind: decision.kind,
          humanId: decision.human.humanId, unitId: decision.unitId, humanChoice: decision.human.choice,
          resolution: decision.resolution, verdict, reasons: Object.fromEntries(FAMILY_ORDER.map((family) =>
            [family, decision.votes[family]?.reason ?? null])), excerpts: entry.excerpts });
      }
    }
    for (const { unitId, via, unit } of kept) {
      const record = state.units.find(({ id }) => id === unitId);
      pushUnit({ ...unit, id: unitId }, { via, addedBy: record?.events[0].step ?? "human-v2-arbitrated",
        events: record ? record.events.map(({ step, op }) => `${step}:${op}`) : [] });
    }
    status.units = kept.length;
  }
  const final = fullChain && documentsStatus.every(({ passesComplete, verification, arbitration }) =>
    passesComplete && verification === "done" && arbitration !== "pending");
  const gold = { schemaVersion: 4, interim: !final, builtAt: new Date().toISOString(),
    method: "sequential verify/complete passes (astra-pass1 -> fable-pass1 -> gemini-pass1 -> astra-pass2 -> fable-pass2 -> gemini-pass2 -> astra-pass3, per-document order in lineage) -> verification of every unit by the 3 models, unanimity 3/3 -> arbitration of every non-unanimous unit and every difference with the human gold v2, unanimity 3/3; unresolved items are excluded and listed in unresolved.json",
    chain, documents: manifest.documents.length,
    documentsWithGold: documentsStatus.filter(({ lastPassStep }) => lastPassStep).length,
    documentsComplete: documentsStatus.filter(({ passesComplete, verification, arbitration }) =>
      passesComplete && verification === "done" && arbitration !== "pending").length,
    counts, softRule: { decides: "character intervals", minOverlapChars: MIN_OVERLAP_CHARS, diagnosticOnly: `ROUGE-L >= ${ROUGE_DIAGNOSTIC_THRESHOLD}` },
    unitCount: units.length, documentsStatus,
    rules: { R4: "stage_aliases: a unit's procedure (ppcmoi, usage_conditionnel, consultation_publique) is accepted as candidate stage" }, units };
  await writeFile(join(outRoot, final ? "consensus.json" : "consensus-interim.json"), `${JSON.stringify(gold, null, 1)}\n`);
  await writeFile(join(outRoot, "disputed.json"), `${JSON.stringify({ interim: !final, items: disputed.length,
    resolved: disputed.filter(({ resolution }) => resolution.outcome === "resolved").length,
    unresolved: unresolved.length, pending: disputed.filter(({ resolution }) => resolution.outcome === "pending").length,
    entries: disputed }, null, 1)}\n`);
  await writeFile(join(outRoot, "unresolved.json"), `${JSON.stringify({ interim: !final,
    note: "pour l'owner : points restés non unanimes après arbitrage (ou version non ancrée), exclus de la référence",
    count: unresolved.length, entries: unresolved }, null, 1)}\n`);
  const pairSummary = (pairs) => ({ pairs: pairs.length,
    joinedByIntervals: pairs.filter(({ overlapChars }) => overlapChars >= MIN_OVERLAP_CHARS).length,
    joinedByRougeL: pairs.filter(({ rougeL: score }) => score >= ROUGE_DIAGNOSTIC_THRESHOLD).length,
    overlapChars: distribution(pairs.map(({ overlapChars }) => overlapChars)), rougeL: distribution(pairs.map(({ rougeL: score }) => score)) });
  const softDiagnostics = { rule: gold.softRule, sameUnitVersions: pairSummary(softPairs.sameUnitVersions),
    distinctUnits: pairSummary(softPairs.distinctUnits), pairs: softPairs,
    note: "sameUnitVersions should be joined, distinctUnits never; ROUGE-L never decides" };
  await writeFile(join(outRoot, "soft-diagnostics.json"), `${JSON.stringify(softDiagnostics, null, 1)}\n`);
  await writeFile(join(outRoot, "grounding-rejects.json"), `${JSON.stringify({ total: rejects.length,
    byStep: rejectCounts, items: rejects }, null, 1)}\n`);
  await writeFile(join(outRoot, "volumes.json"), `${JSON.stringify(volumes, null, 1)}\n`);

  // Calibration against the human gold v2, and explanation of every remaining difference.
  const calibration = { interim: !final, documents: [] };
  let tp = 0; let humanTotal = 0; let v3Total = 0; let tpPrecision = 0; let unexplained = 0;
  const explainedHuman = new Set(humanDiffs.filter(({ verdict }) => !["pending"].includes(verdict))
    .map(({ documentId, humanId }) => `${documentId}:${humanId}`));
  const explainedUnit = new Set(humanDiffs.filter(({ verdict }) => !["pending"].includes(verdict))
    .map(({ documentId, unitId }) => `${documentId}:${unitId}`));
  for (const document of manifest.documents.filter(({ id }) => humanByDocument.has(id))) {
    const humans = humanByDocument.get(document.id);
    const candidates = units.filter(({ documentId }) => documentId === document.id);
    const status = documentsStatus.find(({ documentId }) => documentId === document.id);
    const { pairs, missed, added } = pairOneToOne(humans, candidates);
    const partial = document.id === PARTIAL_HUMAN;
    const available = Boolean(status?.lastPassStep);
    const arbitrationDone = status?.arbitration === "done" || status?.arbitration === "none-needed";
    if (available) {
      tp += pairs.length; humanTotal += humans.length;
      if (!partial) { tpPrecision += pairs.length; v3Total += candidates.length; }
    }
    const unitIdOf = (unit) => unit.id.split("#").pop();
    const missedRows = missed.map(({ id, stage, label, page }) => ({ id, stage, label, page,
      explained: arbitrationDone && explainedHuman.has(`${document.id}:${id}`) }));
    const addedRows = partial ? [] : added.map((unit) => ({ id: unit.id, stage: unit.stage, label: unit.label, page: unit.page,
      citation: unit.citation, explained: arbitrationDone && explainedUnit.has(`${document.id}:${unitIdOf(unit)}`) }));
    if (arbitrationDone) unexplained += [...missedRows, ...addedRows].filter(({ explained }) => !explained).length;
    calibration.documents.push({ documentId: document.id, available, arbitrationDone, partialHuman: partial,
      human: humans.length, v3: candidates.length, matched: pairs.length,
      recall: available ? ratio(pairs.length, humans.length) : null,
      precision: available && !partial ? ratio(pairs.length, candidates.length) : null,
      pairs: pairs.map(([h, c]) => ({ human: h.id, v3: c.id, stage: h.stage, humanLabel: h.label, v3Label: c.label })),
      missed: missedRows, added: addedRows });
  }
  calibration.recall = ratio(tp, humanTotal); calibration.precision = ratio(tpPrecision, v3Total);
  calibration.humanUnitsCovered = humanTotal; calibration.note = `${PARTIAL_HUMAN}: human gold partial, precision N-A there`;
  const byVerdict = {};
  for (const diff of humanDiffs) byVerdict[`${diff.kind}:${diff.verdict}`] = (byVerdict[`${diff.kind}:${diff.verdict}`] ?? 0) + 1;
  calibration.differences = { arbitrated: humanDiffs.length, byKindAndVerdict: byVerdict,
    unexplainedAfterArbitration: unexplained };
  await writeFile(join(outRoot, "human-diffs.json"), `${JSON.stringify({ interim: !final, count: humanDiffs.length,
    byKindAndVerdict: byVerdict, unexplained, entries: humanDiffs }, null, 1)}\n`);
  await writeFile(join(outRoot, "calibration.json"), `${JSON.stringify(calibration, null, 1)}\n`);
  const verdictLabel = { human_right: "l'humain avait raison", v3_right: "le v3 avait raison",
    human_wrong: "l'humain avait tort", neither: "ni l'un ni l'autre", unresolved: "non résolu (owner)", pending: "en attente" };
  const kindLabel = { split: "non unanime", human_only: "unité humaine absente du v3",
    v3_only: "unité v3 absente de l'humain", stage_divergent: "même site, étape différente" };
  const lines = [`# Calibration — corrigé v3${final ? "" : " (INTÉRIMAIRE)"} contre corrigé humain v2`, "",
    "Mesurée sur les 5 documents annotés à la main (36 unités humaines). Le corrigé humain n'est pas",
    "présumé juste : chaque écart est arbitré par les trois modèles sur l'extrait du texte gelé.",
    "Appariement : même document, même étape, et site verbatim partagé. Un à un.",
    `Waterloo : corrigé humain partiel, précision N-A et unités v3 hors humain non arbitrées.`, "",
    `- Rappel du v3 sur l'humain : **${round(calibration.recall)}** (${tp}/${humanTotal} unités humaines des documents disponibles)`,
    `- Précision du v3 (4 documents complets) : **${round(calibration.precision)}** (${tpPrecision}/${v3Total} unités v3)`,
    `- Écarts arbitrés : ${humanDiffs.length} ; écarts restants sans arbitrage : **${unexplained}**`, "",
    "| Document | Humain | v3 | Appariées | Rappel | Précision |", "|---|---:|---:|---:|---:|---:|",
    ...calibration.documents.map((row) => `| ${row.documentId} | ${row.human} | ${row.available ? row.v3 : "N-A"} | ${row.available ? row.matched : "N-A"} | ${round(row.recall)} | ${round(row.precision)} |`),
    "", "## Écarts arbitrés", "", "| Document | Point | Nature | Verdict | Motif (un arbitre) |", "|---|---|---|---|---|",
    ...humanDiffs.map((diff) => `| ${diff.documentId} | ${diff.item} | ${kindLabel[diff.kind]} | ${verdictLabel[diff.verdict]} | ${String(Object.values(diff.reasons).find(Boolean) ?? "N-A").replace(/\|/gu, "/").slice(0, 200)} |`),
    "", "## Unités humaines manquées par la référence finale", "",
    ...calibration.documents.flatMap((row) => row.missed.map((unit) => `- ${row.documentId} · ${unit.id} · ${unit.stage} · p.${unit.page} · ${unit.label} · ${unit.explained ? "arbitré" : "NON EXPLIQUÉ"}`)),
    "", "## Unités de la référence finale absentes du corrigé humain", "",
    ...calibration.documents.flatMap((row) => row.added.map((unit) => `- ${row.documentId} · ${unit.id} · ${unit.stage} · p.${unit.page} · ${unit.label} · ${unit.explained ? "arbitré" : "NON EXPLIQUÉ"}`)), ""];
  await writeFile(join(outRoot, "calibration.md"), `${lines.join("\n")}\n`);
  const annexes = (await readdir(join(outRoot, "avis")).catch(() => [])).filter((name) => name.endsWith(".md")).sort();
  const report = [`# Référence oracle v3${final ? "" : " (INTÉRIMAIRE)"} — unanimité et arbitrage`, "",
    `- Documents complets : ${gold.documentsComplete}/${manifest.documents.length}`,
    `- Unités vérifiées : ${counts.items}`,
    `- Unanimes à la vérification : ${counts.unanimousPresent} retenues, ${counts.unanimousAbsent} écartées`,
    `- Fusionnées par recouvrement d'intervalles (≥ ${MIN_OVERLAP_CHARS} caractères normalisés, même objet exact, même étape, même page) au lieu d'être arbitrées : ${counts.softMerged} (verdict d'arbitrage concordant ${counts.softMergedArbitrationAgreed}, différent ${counts.softMergedArbitrationDiffered}). Diagnostic ROUGE-L ≥ ${ROUGE_DIAGNOSTIC_THRESHOLD}, qui ne décide rien : ${counts.rougeWouldMerge} fusions auraient eu lieu ; ${counts.intervalOnlyMerges} par les intervalles seuls, ${counts.rougeOnlyMerges} par ROUGE-L seul.`,
    `- Arbitrées et résolues : ${counts.arbitrated} (${counts.arbitratedPresent} retenues, ${counts.arbitratedAbsent} écartées)`,
    `- Non résolues (owner, \`unresolved.json\`) : ${counts.unresolved}`,
    `- En attente : ${counts.pending}`,
    `- Unités de la référence : ${units.length}`,
    `- Écarts avec l'humain : ${humanDiffs.length} arbitrés, ${unexplained} sans explication`, "",
    `Paires de versions d'une même unité (même objet, même étape) : ${softDiagnostics.sameUnitVersions.pairs} ; rapprochées par les intervalles ${softDiagnostics.sameUnitVersions.joinedByIntervals}, par ROUGE-L ${softDiagnostics.sameUnitVersions.joinedByRougeL} ; intersection min ${softDiagnostics.sameUnitVersions.overlapChars.min ?? "N-A"} car. ; ROUGE-L ${softDiagnostics.sameUnitVersions.rougeL.min?.toFixed(2) ?? "N-A"}–${softDiagnostics.sameUnitVersions.rougeL.max?.toFixed(2) ?? "N-A"}.`,
    `Paires d'unités distinctes (même objet, même étape, même page) : ${softDiagnostics.distinctUnits.pairs} ; rapprochées à tort par les intervalles ${softDiagnostics.distinctUnits.joinedByIntervals}, par ROUGE-L ${softDiagnostics.distinctUnits.joinedByRougeL} ; ROUGE-L max ${softDiagnostics.distinctUnits.rougeL.max?.toFixed(2) ?? "N-A"}.`,
    "Limite assumée (avis Astra) : deux passages éloignés qui prouvent le même acte ne sont pas rapprochés par les intervalles ; ils restent en arbitrage.",
    ...softDiagnostics.pairs.sameUnitVersions.filter(({ overlapChars }) => overlapChars < MIN_OVERLAP_CHARS)
      .map(({ documentId, unitId, page, overlapChars, rougeL: score }) => `  - non rapprochée : ${documentId} ${unitId}, pages ${page.join("/")}, intersection ${overlapChars} car., ROUGE-L ${score.toFixed(2)}`),
    "Liste nominative des paires, avec leurs deux citations : `soft-diagnostics.json`.", "",
    "**Pourquoi les intervalles et pas ROUGE-L.** "
      + `Sur les ${softDiagnostics.distinctUnits.pairs} paires d'unités distinctes qui partagent objet, étape et page, les intervalles n'en rapprochent aucune`
      + `${softDiagnostics.distinctUnits.joinedByIntervals ? ` (en fait ${softDiagnostics.distinctUnits.joinedByIntervals})` : ""}, ROUGE-L en rapprocherait ${softDiagnostics.distinctUnits.joinedByRougeL}, jusqu'à ${softDiagnostics.distinctUnits.rougeL.max?.toFixed(2) ?? "N-A"}. `
      + `Sur le corrigé, les deux méthodes fusionnent les mêmes ${counts.softMerged} unités (${counts.intervalOnlyMerges} par les intervalles seuls, ${counts.rougeOnlyMerges} par ROUGE-L seul) : le choix ne change pas la référence, il change le risque. `
      + "Dans la notation des bras, les correspondances apportées par ROUGE-L seul sont comptées dans `tableau-f1-100.md` ; l'avis Fable les décrit comme majoritairement fausses (numéros voisins).",
    "Les deux avis contradicteurs recommandent les positions dans le texte plutôt que ROUGE-L, et jugent qu'une calibration de seuil sur les 36 unités humaines ne vaut pas validation.", "",
    "## Annexes — avis contradicteurs, verbatim", "",
    ...annexes.map((name) => `- \`avis/${name}\`${ANNEX_NOTES[name] ? ` — ${ANNEX_NOTES[name]}` : ""}`), "",
    "| Nature de l'écart | Verdict | Nombre |", "|---|---|---:|",
    ...Object.entries(byVerdict).map(([key, count]) => { const [kind, verdict] = key.split(":");
      return `| ${kindLabel[kind]} | ${verdictLabel[verdict]} | ${count} |`; }), ""];
  await writeFile(join(outRoot, "rapport-reference.md"), `${report.join("\n")}\n`);
  return { final, units: units.length, counts, rejects: rejects.length, humanDiffs: humanDiffs.length, unexplained,
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
