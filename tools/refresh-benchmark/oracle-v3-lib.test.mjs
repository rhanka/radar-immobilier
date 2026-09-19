import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { activeUnits, applyOperations, calibrationMatch, documentPages, emptyState,
  groundUnit, isDuplicate, keysCompatible, loadPrompts, objectKey, pairOneToOne, parseJsonObject,
  passUserMessage, STEPS } from "./oracle-v3-lib.mjs";
import { arbitrateUserMessage, arbitrationItemsOf, finalUnits, humanVerdict, resolveArbitration, reviewItemsOf, softMerge,
  unanimity, verifyUserMessage } from "./oracle-v3-verdict.mjs";
import { build } from "./oracle-v3-build.mjs";
import { chainSteps, claudeSeatFailure, withWatchdog, createTransport, documentLineage, humanUnitsByDocument, meshArm, previousPassStep, runStep } from "./oracle-v3-step.mjs";
import { codexCapOption, timedFetch } from "./v101-provider.mjs";
import { createServer } from "node:http";
import { relabelEarlyAstraPass2 } from "./oracle-v3-relabel-pass1b.mjs";
import { archiveStep } from "./oracle-v3-archive-step.mjs";
import { actsOf, applyDecisions, runCascade, SOURCE_DIR } from "./precision-cascade.mjs";
import { sha256 } from "./oracle-v3-lib.mjs";
import { aggregate, scoreCase, softMatcherFor, unresolvedUnits } from "./score-oracle-v3.mjs";
import { MIN_OVERLAP_CHARS, rougeL, softEquivalent, spanOverlap } from "./oracle-v3-soft.mjs";
import { scoreValidV2 } from "./score-oracle-v2.mjs";

const repositoryRoot = process.env.BENCHMARK_REPOSITORY_ROOT ?? resolve(import.meta.dirname, "../..");
const pages = [
  "ORDRE DU JOUR\n7.1 1070, RUE BISSONNETTE - PIIA lotissement\n7.2 1070,RUE BISSONNETTE - PIIA jumelés\n",
  "RÉSOLUTION 2026-08-150\nQUE le conseil adopte le Règlement 2026-14 sur les usages conditionnels.\n"
    + "2026-04 modifiant le Règlement de plan d’urbanisme 2014-04 ;\n2026-05 modifiant le Règlement de zonage 2014-05 ;\n",
];
const unit = (overrides) => ({ label: "Adoption 2026-14", stage: "adoption", procedure: null,
  objet: "Règlement 2026-14", page: 2, citation: "QUE le conseil adopte le Règlement 2026-14",
  anchor: "Règlement 2026-14", ...overrides });

test("grounding: verbatim on the declared page, v9 normalisation, raw span recovered", () => {
  const grounded = groundUnit(unit({ citation: "que le conseil ADOPTE le reglement 2026-14" }), pages);
  assert.equal(grounded.ok, true);
  assert.equal(grounded.unit.citation, "QUE le conseil adopte le Règlement 2026-14");
  assert.equal(grounded.unit.anchor, "Règlement 2026-14");
  assert.equal(grounded.pageCorrected, false);
});

test("grounding: wrong page corrected, unknown excerpt, short excerpt and bad stage rejected", () => {
  const moved = groundUnit(unit({ page: 1 }), pages);
  assert.equal(moved.ok, true); assert.equal(moved.unit.page, 2); assert.equal(moved.pageCorrected, true);
  assert.equal(groundUnit(unit({ citation: "QUE le conseil adopte le Règlement 2026-99" }), pages).code,
    "citation_not_found_in_document");
  assert.equal(groundUnit(unit({ citation: "Règlement 2026-14" }), pages).code, "citation_too_short");
  assert.equal(groundUnit(unit({ stage: "ppcmoi" }), pages).code, "stage_out_of_vocabulary");
});

test("grounding: a citation spanning two lines is kept; anchor outside the citation is replaced", () => {
  const grounded = groundUnit(unit({ citation: "2026-04 modifiant le Règlement de plan d’urbanisme 2014-04 ; 2026-05",
    anchor: "Règlement 2026-14", stage: "adoption", objet: "2026-04" }), pages);
  assert.equal(grounded.ok, true);
  assert.equal(grounded.anchorReplaced, true);
  assert.ok(grounded.unit.citation.startsWith(grounded.unit.anchor));
});

test("object keys: bylaw, lot and address forms agree; distinct bylaws conflict", () => {
  assert.equal(objectKey("Règlement no 2026-05"), objectKey("2026-05"));
  assert.equal(objectKey("lot 5 191 695"), "5191695");
  assert.equal(objectKey("1070, RUE BISSONNETTE"), objectKey("1070 rue Bissonnette"));
  assert.equal(keysCompatible(objectKey("2026-04"), objectKey("2026-05")), "conflict");
  assert.equal(keysCompatible(objectKey("DDM2026-058"), objectKey("dossier DDM2026-058")), "equal");
  assert.equal(keysCompatible("", objectKey("2026-05")), null);
});

test("duplicate guard: overlapping span of the same object is a duplicate; two agenda items on one address are not", () => {
  const first = groundUnit(unit({ stage: "piia", objet: "1070, rue Bissonnette", page: 1,
    citation: "7.1 1070, RUE BISSONNETTE - PIIA lotissement", anchor: "1070, RUE BISSONNETTE" }), pages).unit;
  const second = groundUnit(unit({ stage: "piia", objet: "1070, rue Bissonnette", page: 1,
    citation: "7.2 1070,RUE BISSONNETTE - PIIA jumelés", anchor: "1070,RUE BISSONNETTE" }), pages).unit;
  const again = groundUnit(unit({ stage: "piia", objet: "1070 rue Bissonnette", page: 1,
    citation: "1070, RUE BISSONNETTE - PIIA lotissement", anchor: "1070, RUE BISSONNETTE" }), pages).unit;
  assert.equal(isDuplicate(second, first), false);
  assert.equal(isDuplicate(again, first), true);
  const bylaw04 = groundUnit(unit({ objet: "2026-04", citation: "2026-04 modifiant le Règlement de plan d’urbanisme",
    anchor: "2026-04 modifiant" }), pages).unit;
  const bylaw05 = groundUnit(unit({ objet: "2026-05", citation: "2026-04 modifiant le Règlement de plan d’urbanisme",
    anchor: "2026-04 modifiant" }), pages).unit;
  assert.equal(isDuplicate(bylaw05, bylaw04), false, "one resolution, seven by-laws: one unit each");
});

test("operations: add, correct, remove with reasons; every invalid operation is rejected and coded", () => {
  let { state, rejects, applied } = applyOperations(emptyState("d"), [
    { op: "add", unit: unit({}), reason: "résolution d'adoption" },
    { op: "add", unit: unit({ stage: "avis_motion", label: "Avis 2026-14" }), reason: "avis" },
    { op: "add", unit: unit({ citation: "absent du texte, mais assez long" }), reason: "x" },
    { op: "add", unit: unit({}), reason: "" },
    { op: "add", unit: unit({ label: "doublon" }), reason: "doublon" },
    { op: "remove", id: "u09", reason: "inconnu" },
    { op: "merge", id: "u01", reason: "?" },
  ], pages, "astra-pass1");
  assert.deepEqual(applied.map(({ op, id }) => `${op}:${id}`), ["add:u01", "add:u02"]);
  assert.deepEqual(rejects.map(({ code }) => code), ["citation_not_found_in_document", "reason_missing",
    "duplicate_add", "unknown_id", "op_unknown"]);
  ({ state, rejects, applied } = applyOperations(state, [
    { op: "correct", id: "u01", unit: unit({ label: "Adoption du Règlement 2026-14 (usages conditionnels)",
      procedure: "usage_conditionnel" }), reason: "procédure d'usage conditionnel" },
    { op: "remove", id: "u01", reason: "second op same id" },
    { op: "correct", id: "u02", unit: unit({ stage: "avis_motion", label: "Avis 2026-14" }), reason: "identique" },
    { op: "remove", id: "u02", reason: "l'avis de motion n'est qu'un rappel historique" },
  ], pages, "fable-pass1"));
  assert.deepEqual(rejects.map(({ code }) => code), ["conflicting_ops_same_id", "no_change"]);
  assert.deepEqual(applied.map(({ op, id }) => `${op}:${id}`), ["correct:u01", "remove:u02"]);
  assert.deepEqual(activeUnits(state).map(({ id, procedure }) => `${id}:${procedure}`), ["u01:usage_conditionnel"]);
});

const vote = (item, choice, reason = "motif") => ({ item, choice, reason });
const recordsOf = (byFamily) => Object.fromEntries(Object.entries(byFamily).map(([family, votes]) => [family, { votes }]));

test("verification: every unit ever proposed is voted; only 3/3 with a reason is unanimous", () => {
  let { state } = applyOperations(emptyState("d"), [
    { op: "add", unit: unit({}), reason: "adoption" },
    { op: "add", unit: unit({ stage: "avis_motion" }), reason: "avis" },
  ], pages, "astra-pass1");
  ({ state } = applyOperations(state, [{ op: "remove", id: "u02", reason: "rappel historique" }], pages, "gemini-pass1"));
  const items = reviewItemsOf(state);
  assert.deepEqual(items.map(({ item, unitId, current, options }) => `${item}:${unitId}:${current}:${options.map(({ option }) => option).join("/")}`),
    ["i01:u01:v1:v1/absent", "i02:u02:absent:v1/absent"]);
  assert.equal(unanimity(items[0], { astra: vote("i01", "v1"), fable: vote("i01", "v1"), gemini: vote("i01", "v1") }).outcome, "unanimous");
  assert.equal(unanimity(items[0], { astra: vote("i01", "v1"), fable: vote("i01", "v1"), gemini: vote("i01", "v1", " ") }).outcome, "split",
    "a vote without reason does not count");
  assert.equal(unanimity(items[0], { astra: vote("i01", "v1"), fable: vote("i01", "v7"), gemini: vote("i01", "v1") }).outcome, "split");
  assert.equal(unanimity(items[0], { astra: vote("i01", "v1"), fable: null, gemini: vote("i01", "v1") }).outcome, "split");
  const message = verifyUserMessage({ id: "d", city: "c", date: "2026-01-01" }, pages, items);
  assert.match(message, /"item": "i02"/u); assert.doesNotMatch(message, /astra|gemini|current|rappel historique/u);
});

test("arbitration: splits and every human difference are arbitrated; unanimity decides, the rest is unresolved", () => {
  const { state } = applyOperations(emptyState("d"), [
    { op: "add", unit: unit({}), reason: "adoption" },
    { op: "add", unit: unit({ stage: "avis_motion", label: "Avis 2026-14" }), reason: "avis" },
    { op: "add", unit: unit({ stage: "piia", label: "PIIA", objet: "1070, rue Bissonnette", page: 1,
      citation: "7.1 1070, RUE BISSONNETTE - PIIA lotissement", anchor: "1070, RUE BISSONNETTE" }), reason: "piia" },
    { op: "add", unit: unit({ label: "Adoption 2026-04", objet: "2026-04",
      citation: "2026-04 modifiant le Règlement de plan d’urbanisme 2014-04", anchor: "2026-04 modifiant" }), reason: "adoption" },
  ], pages, "astra-pass1");
  const all = (choice) => ["i01", "i02", "i03", "i04"].map((item) => vote(item, choice));
  const records = recordsOf({ astra: all("v1"), fable: [vote("i01", "v1"), vote("i02", "absent"), vote("i03", "v1"), vote("i04", "v1")],
    gemini: all("v1") });
  const human = (id, stage, page, anchor, citation) => ({ id, stage, page, anchor, citation, label: `humain ${id}` });
  const humans = [human("H1", "adoption", 2, "Règlement 2026-14", "QUE le conseil adopte le Règlement 2026-14"),
    human("H2", "derogation_mineure", 1, "1070, RUE BISSONNETTE", "7.1 1070, RUE BISSONNETTE - PIIA lotissement"),
    human("H3", "projet_reglement", 2, "2026-05 modifiant", "2026-05 modifiant le Règlement de zonage 2014-05")];
  const items = arbitrationItemsOf({ documentId: "d", pages, state, records, humans });
  assert.deepEqual(items.map(({ item, kind, unitId, humanId, human: position }) =>
    `${item}:${kind}:${unitId}:${humanId ?? "-"}:${position?.choice}`),
  ["a01:split:u02:-:absent", "a02:stage_divergent:u03:H2:v2", "a03:human_only:null:H3:v1", "a04:v3_only:u04:-:absent"]);
  assert.equal(items[2].options[0].unit.grounded, true, "the human unit is grounded in the frozen text");
  const message = arbitrateUserMessage({ id: "d", city: "c", date: "2026-01-01" }, pages, items);
  assert.match(message, /annotateur A/u); assert.match(message, /reference_humaine/u);
  assert.doesNotMatch(message, /astra|fable|gemini/u);
  const byItem = { a01: ["absent", "absent", "absent"], a02: ["v1", "v1", "v1"], a03: ["v1", "v1", "v1"], a04: ["v1", "v1", "absent"] };
  const arbitrationRecords = recordsOf(Object.fromEntries(["astra", "fable", "gemini"].map((family, index) =>
    [family, Object.entries(byItem).map(([item, choices]) => vote(item, choices[index]))])));
  const { units, decisions } = finalUnits({ state, records, arbitration: items, arbitrationRecords });
  assert.deepEqual(units.map(({ unitId, via }) => `${unitId}:${via}`).sort(), ["h:H3:arbitrated", "u01:unanimous", "u03:arbitrated"]);
  assert.deepEqual(decisions.map(({ resolution }) => resolution.outcome), ["resolved", "resolved", "resolved", "unresolved"]);
  assert.deepEqual(decisions.map(humanVerdict), ["human_right", "v3_right", "human_right", "unresolved"]);
  const partial = arbitrationItemsOf({ documentId: "d", pages, state, records, humans: [humans[2]], partialHuman: true });
  assert.deepEqual(partial.map(({ kind, human: position }) => `${kind}:${position?.choice ?? "-"}`), ["split:-", "human_only:v1"],
    "partial human gold: no v3_only item, no human position on splits");
  const ungrounded = { options: [{ option: "v1", unit: { grounded: false } }, { option: "absent", unit: null }] };
  assert.deepEqual(resolveArbitration(ungrounded, { astra: vote("a", "v1"), fable: vote("a", "v1"), gemini: vote("a", "v1") }),
    { outcome: "unresolved", choice: "v1", tally: { v1: 3 }, cause: "option_not_grounded" });
});

test("calibration pairing uses stage plus a shared verbatim site, one to one", () => {
  const human = { id: "B14", stage: "adoption", page: 2, anchor: "QUE le conseil adopte le Règlement 2026-14",
    citation: "QUE le conseil adopte le Règlement 2026-14 sur les usages" };
  const good = groundUnit(unit({}), pages).unit;
  assert.equal(calibrationMatch(human, good), true);
  assert.equal(calibrationMatch(human, { ...good, stage: "avis_motion" }), false);
  assert.equal(calibrationMatch(human, { ...good, page: 1 }), false);
  const { pairs, missed, added } = pairOneToOne([human, { ...human, id: "B14bis" }], [good]);
  assert.equal(pairs.length, 1); assert.equal(missed.length, 1); assert.equal(added.length, 0);
});

test("R4 stage aliases credit a contract-v9 procedure stage only when enabled; refusals are net misses", () => {
  const document = { id: "d", originalKey: "k", sha256: "s", sourceUrl: "u" };
  const identity = { source_file: "k", rawRef: "k", docSha: "s", sourceUrl: "u", modality: "pdf" };
  const output = { nodes: [{ id: "n", node_type: "DesignationEvent", stage: "usage_conditionnel",
    citations: [{ ...identity, page: 2, excerpt: "QUE le conseil adopte le Règlement 2026-14" }] }], edges: [] };
  const gold = [{ id: "g", stage: "adoption", stage_aliases: ["usage_conditionnel"], page: 2, anchor: "Règlement 2026-14" }];
  assert.equal(scoreValidV2(output, document, gold).tp, 0);
  assert.equal(scoreValidV2(output, document, gold, { useStageAliases: true }).tp, 1);
  const refused = scoreCase({ state: "refused" }, document, gold, {});
  assert.deepEqual([refused.tp, refused.fp, refused.fn], [0, 0, 1]);
  const total = aggregate([{ tp: 1, fp: 1, fn: 0 }, refused]);
  assert.deepEqual([total.precision, total.recall, total.f1], [0.5, 0.5, 0.5]);
});

test("steps: owner order, previous gold, convergence after the last pass; guards block real calls", async () => {
  assert.deepEqual(STEPS.map(({ id }) => id), ["astra-pass1", "astra-pass2", "astra-pass3", "fable-pass1", "fable-pass2",
    "gemini-pass1", "gemini-pass2", "converge-astra", "converge-fable", "converge-gemini",
    "arbitrate-astra", "arbitrate-fable", "arbitrate-gemini"]);
  assert.equal(previousPassStep("astra-pass3", ["astra", "fable", "gemini"]).id, "gemini-pass2");
  assert.equal(previousPassStep("converge-astra", ["astra", "fable", "gemini"]).id, "astra-pass3");
  assert.equal(previousPassStep("arbitrate-gemini", ["astra", "fable", "gemini"]).id, "astra-pass3");
  assert.equal(previousPassStep("astra-pass1", ["astra", "fable", "gemini"]), null);
  assert.deepEqual(chainSteps(["astra", "fable", "gemini"]).map(({ id }) => id), ["astra-pass1", "fable-pass1",
    "gemini-pass1", "astra-pass2", "fable-pass2", "gemini-pass2", "astra-pass3"]);
  assert.equal(previousPassStep("fable-pass1", ["astra", "fable", "gemini"]).id, "astra-pass1");
  assert.equal(previousPassStep("astra-pass2", ["astra", "fable", "gemini"]).id, "gemini-pass1");
  assert.equal(previousPassStep("converge-fable", ["astra", "fable", "gemini"]).id, "astra-pass3");
  assert.equal(chainSteps(["fable", "gemini"])[0].id, "fable-pass1");
  const saved = { go: process.env.ORACLE_V3_GO, astra: process.env.ORACLE_V3_ASTRA_GO };
  delete process.env.ORACLE_V3_GO; delete process.env.ORACLE_V3_ASTRA_GO;
  await assert.rejects(createTransport(STEPS[2], null), /ORACLE_V3_GO=1/u);
  process.env.ORACLE_V3_GO = "1";
  await assert.rejects(createTransport(STEPS[0], null), /ORACLE_V3_ASTRA_GO=1/u);
  if (saved.go === undefined) delete process.env.ORACLE_V3_GO; else process.env.ORACLE_V3_GO = saved.go;
  if (saved.astra !== undefined) process.env.ORACLE_V3_ASTRA_GO = saved.astra;
});

test("prompts: the three blocks load; the pass message carries the current gold without history", async () => {
  const prompts = await loadPrompts(repositoryRoot);
  assert.match(prompts.pass.text, /Mentions historiques du même dossier ne multiplient pas le rappel/u);
  assert.equal(prompts.pass.sha256, "9cfe6bc0cfc7e5742be391c29845a988c04f59b8e44f8e8bf8e505269e64a654", "the pass prompt already used is unchanged");
  assert.match(prompts.verify.text, /"item":"i01"/u); assert.match(prompts.verify.text, /tous les vérificateurs/u);
  assert.match(prompts.arbitrate.text, /"item":"a01"/u); assert.match(prompts.arbitrate.text, /non présumée juste|la référence humaine non plus/u);
  const { state } = applyOperations(emptyState("d"), [{ op: "add", unit: unit({}), reason: "adoption" }], pages, "astra-pass1");
  const message = passUserMessage({ id: "d", city: "c", date: "2026-01-01" }, pages, activeUnits(state));
  assert.match(message, /"id": "u01"/u); assert.doesNotMatch(message, /astra-pass1|reason/u);
  assert.match(message, /=== PAGE 2 ===/u);
  assert.deepEqual(parseJsonObject("```json\n{\"operations\":[]}\n```"), { operations: [] });
});

test("end to end on canned answers: 6 passes, 3 verifications, 3 arbitrations, build; no network", async () => {
  const root = await mkdtemp(join(tmpdir(), "oracle-v3-e2e-"));
  try {
    const manifest = JSON.parse(await readFile(join(repositoryRoot, "docs/reviews/refresh-benchmark/v101b/manifest.json"), "utf8"));
    const document = manifest.documents.find(({ id }) => id === "lac-des-seize-iles-2026-09-agenda");
    const fixtures = join(root, "fixtures");
    const answers = {
      "astra-pass1": { operations: [
        { op: "add", reason: "avis prévu", unit: { label: "Avis de motion 2026-08 prévu", stage: "avis_motion", procedure: null,
          objet: "2026-08", page: 1, citation: "Avis de motion", anchor: "Avis de motion" } }] },
      "astra-pass2": { operations: [] }, "fable-pass1": { operations: [] }, "fable-pass2": { operations: [] },
      "gemini-pass1": { operations: [{ op: "remove", id: "u01", reason: "test de désaccord" }] },
      "gemini-pass2": { operations: [] }, "astra-pass3": { operations: [] },
      "converge-astra": { votes: [{ item: "i01", choice: "v1", reason: "prévu à l'ordre du jour" }] },
      "converge-fable": { votes: [{ item: "i01", choice: "v1", reason: "prévu à l'ordre du jour" }] },
      "converge-gemini": { votes: [{ item: "i01", choice: "absent", reason: "x" }] },
    };
    const text = await readFile(join(repositoryRoot, document.runtimeTextRelativePath), "utf8");
    const line = text.split("\n").find((value) => /Avis de motion/u.test(value)).trim();
    answers["astra-pass1"].operations[0].unit.citation = line.slice(0, 120);
    const writeAnswers = async (entries) => {
      for (const [step, answer] of Object.entries(entries)) {
        await mkdir(join(fixtures, step), { recursive: true });
        await writeFile(join(fixtures, step, `${document.id}.txt`), JSON.stringify(answer));
      }
    };
    await writeAnswers(answers);
    const out = join(root, "out");
    const run = (id) => runStep({ stepId: id, docs: [document.id], concurrency: 1,
      transport: `fake:${fixtures}`, chain: ["astra", "fable", "gemini"], out }, { repositoryRoot, log() {} });
    assert.equal((await run("arbitrate-astra")).notReady, 1, "arbitration waits for the passes and the three verifications");
    for (const { id } of [...chainSteps(["astra", "fable", "gemini"]), ...STEPS.filter(({ kind }) => kind === "converge")]) {
      assert.equal((await run(id)).done, 1, id);
    }
    assert.equal((await run("fable-pass1")).skipped, 1, "resumable: an existing output is never recomputed");
    const interim = await build({ repositoryRoot, out });
    assert.equal(interim.final, false);
    // Arbitration items: the split avis unit plus the human differences of this document.
    const verification = JSON.parse(await readFile(join(out, "annotations/converge-astra", `${document.id}.json`), "utf8"));
    assert.deepEqual(verification.items.map(({ item, unitId }) => `${item}:${unitId}`), ["i01:u01"]);
    const state = JSON.parse(await readFile(join(out, "corrige/astra-pass3", `${document.id}.json`), "utf8"));
    const records = Object.fromEntries(await Promise.all(["astra", "fable", "gemini"].map(async (family) => [family,
      JSON.parse(await readFile(join(out, `annotations/converge-${family}`, `${document.id}.json`), "utf8"))])));
    const humans = (await humanUnitsByDocument(repositoryRoot, [document])).get(document.id);
    assert.equal(humans.length, 4);
    const items = arbitrationItemsOf({ documentId: document.id, pages: documentPages(text), state, records, humans });
    const kinds = items.map(({ kind }) => kind);
    assert.equal(kinds[0], "split"); assert.ok(kinds.includes("human_only"), "the human units are arbitrated");
    // Everyone agrees on every item except the last one, left unresolved.
    const itemsVotes = (family) => ({ votes: items.map(({ item, options }, index) => ({ item,
      choice: family === "gemini" && index === items.length - 1 ? "absent" : options[0].option, reason: "texte" })) });
    await writeAnswers({ "arbitrate-astra": itemsVotes("astra"), "arbitrate-fable": itemsVotes("fable"), "arbitrate-gemini": itemsVotes("gemini") });
    for (const family of ["astra", "fable", "gemini"]) assert.equal((await run(`arbitrate-${family}`)).done, 1, family);
    const result = await build({ repositoryRoot, out });
    const gold = JSON.parse(await readFile(join(out, "consensus-interim.json"), "utf8"));
    const documentGold = gold.units.filter(({ documentId }) => documentId === document.id);
    assert.equal(gold.counts.unresolved, 1);
    assert.equal(gold.counts.arbitrated, items.length - 1);
    assert.equal(documentGold.length, items.length - 1, "every resolved item keeps its present option");
    const record = JSON.parse(await readFile(join(out, "annotations/arbitrate-fable", `${document.id}.json`), "utf8"));
    assert.deepEqual(record.items.map(({ item }) => item), items.map(({ item }) => item));
    const unresolved = JSON.parse(await readFile(join(out, "unresolved.json"), "utf8"));
    assert.equal(unresolved.count, 1); assert.ok(unresolved.entries[0].excerpts.length >= 1);
    assert.equal(result.unexplained, 0, "every difference with the human gold is explained");
    const diffs = JSON.parse(await readFile(join(out, "human-diffs.json"), "utf8"));
    assert.ok(diffs.entries.every(({ verdict }) => ["human_right", "v3_right", "human_wrong", "neither", "unresolved"].includes(verdict)));
    assert.match(await readFile(join(out, "rapport-reference.md"), "utf8"), /Non résolues/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("order fix: early astra-pass2 becomes astra-pass1b; astra-pass2 then runs every document after gemini-pass1", async () => {
  const root = await mkdtemp(join(tmpdir(), "oracle-v3-order-"));
  try {
    const manifest = JSON.parse(await readFile(join(repositoryRoot, "docs/reviews/refresh-benchmark/v101b/manifest.json"), "utf8"));
    const documents = manifest.documents.filter(({ id }) => ["lac-des-seize-iles-2026-09-agenda",
      "saint-etienne-de-bolton-2026-08-04"].includes(id));
    assert.equal(documents.length, 2);
    const [early, late] = documents.map(({ id }) => id);
    const fixtures = join(root, "fixtures");
    for (const document of documents) {
      const text = await readFile(join(repositoryRoot, document.runtimeTextRelativePath), "utf8");
      const line = text.split("\n").map((value) => value.trim()).find((value) => value.length >= 40);
      const unit = { label: "Unité test", stage: "inconnu", procedure: null, objet: null, page: 1,
        citation: line.slice(0, 120), anchor: line.slice(0, 20) };
      const answers = { "astra-pass1": { operations: [{ op: "add", reason: "r", unit }] },
        "astra-pass2": { operations: [{ op: "correct", id: "u01", reason: "libellé", unit: { ...unit, label: "Unité test (corrigée)" } }] },
        "fable-pass1": { operations: [] }, "gemini-pass1": { operations: [] }, "fable-pass2": { operations: [] } };
      for (const [step, answer] of Object.entries(answers)) {
        await mkdir(join(fixtures, step), { recursive: true });
        await writeFile(join(fixtures, step, `${document.id}.txt`), JSON.stringify(answer));
      }
    }
    const out = join(root, "out");
    const run = (stepId, docs, chain = ["astra", "fable", "gemini"]) => runStep({ stepId, docs, concurrency: 1,
      transport: `fake:${fixtures}`, chain, out }, { repositoryRoot, log() {} });
    assert.equal((await run("astra-pass1", [early, late])).done, 2);
    // The first order: astra-pass2 right after astra-pass1, on the early document only.
    assert.equal((await run("astra-pass2", [early], ["astra"])).done, 1);
    assert.equal((await run("astra-pass2", [late])).notReady, 1, "astra-pass2 waits for gemini-pass1");
    assert.equal((await run("fable-pass1", [early])).done, 1);
    // Owner fix: relabel, then finish fable-pass1 and gemini-pass1.
    assert.deepEqual(await relabelEarlyAstraPass2({ outRoot: out }), { documents: 1, files: 7 });
    await assert.rejects(relabelEarlyAstraPass2({ outRoot: out }), /already done/u);
    await assert.rejects(readFile(join(out, "annotations/astra-pass2", `${early}.json`), "utf8"), /ENOENT/u);
    const fable = JSON.parse(await readFile(join(out, "annotations/fable-pass1", `${early}.json`), "utf8"));
    assert.equal(fable.inputStateStep, "astra-pass1b");
    assert.equal(fable.inputStateSha256, sha256(JSON.stringify(JSON.parse(
      await readFile(join(out, "corrige/astra-pass1b", `${early}.json`), "utf8")))));
    assert.deepEqual(await documentLineage(out, early), ["astra-pass1", "astra-pass1b", "fable-pass1"]);
    const fableGold = JSON.parse(await readFile(join(out, "corrige/fable-pass1", `${early}.json`), "utf8"));
    assert.equal(activeUnits(fableGold)[0].label, "Unité test (corrigée)", "the early check stays in the gold");
    assert.doesNotMatch(JSON.stringify(fableGold), /astra-pass2/u);
    await assert.rejects(run("astra-pass1b", [early]), /unknown oracle-v3 step/u);
    const fableRest = await run("fable-pass1", [early, late]);
    assert.deepEqual([fableRest.done, fableRest.skipped], [1, 1]);
    assert.equal((await run("gemini-pass1", [early, late])).done, 2);
    // astra-pass2 now skips nothing: both documents, the early one included.
    const astra = await run("astra-pass2", [early, late]);
    assert.deepEqual([astra.done, astra.skipped, astra.notReady], [2, 0, 0]);
    for (const documentId of [early, late]) {
      const record = JSON.parse(await readFile(join(out, "annotations/astra-pass2", `${documentId}.json`), "utf8"));
      assert.equal(record.inputStateStep, "gemini-pass1", documentId);
    }
    assert.equal((await run("fable-pass2", [early, late])).done, 2);
    assert.deepEqual(await documentLineage(out, early),
      ["astra-pass1", "astra-pass1b", "fable-pass1", "gemini-pass1", "astra-pass2", "fable-pass2"]);
    assert.deepEqual(await documentLineage(out, late),
      ["astra-pass1", "fable-pass1", "gemini-pass1", "astra-pass2", "fable-pass2"]);
    const log = JSON.parse(await readFile(join(out, "relabel-astra-pass1b.json"), "utf8"));
    assert.deepEqual(log.documents, [early]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("output cap: 65 536 for every Gemini step, unchanged elsewhere (benchmark arms keep 32 768)", () => {
  for (const step of STEPS.filter(({ family }) => family === "gemini")) {
    assert.deepEqual(codexCapOption(meshArm(step)), { maxOutputTokens: 65_536 }, step.id);
  }
  for (const step of STEPS.filter(({ family }) => family === "astra")) assert.deepEqual(codexCapOption(meshArm(step)), {}, step.id);
  assert.deepEqual(codexCapOption({ capEnforced: true }), { maxOutputTokens: 32_768 });
  assert.deepEqual(codexCapOption({ capEnforced: false }), {});
});

test("Claude seat: a limit message stops at once; 3 consecutive empty failures stop too", () => {
  assert.match(claudeSeatFailure("You've hit your limit · resets 5pm", { is_error: true }, 0).stop, /seat limit/u);
  const empty = { is_error: true, usage: { output_tokens: 0 } };
  let state = claudeSeatFailure("", empty, 0); assert.equal(state.stop, null);
  state = claudeSeatFailure("", empty, state.emptyFailures); assert.equal(state.stop, null);
  state = claudeSeatFailure("", empty, state.emptyFailures); assert.match(state.stop, /3 consecutive empty/u);
  assert.equal(claudeSeatFailure("boom", { is_error: true, usage: { output_tokens: 12 } }, 2).emptyFailures, 0,
    "a failure that produced output resets the count");
});

test("astra-pass3 reads the gemini-pass2 gold; archived verification votes are never reused", async () => {
  const root = await mkdtemp(join(tmpdir(), "oracle-v3-pass3-"));
  try {
    const manifest = JSON.parse(await readFile(join(repositoryRoot, "docs/reviews/refresh-benchmark/v101b/manifest.json"), "utf8"));
    const documents = manifest.documents.filter(({ id }) => ["lac-des-seize-iles-2026-09-agenda",
      "saint-etienne-de-bolton-2026-08-04"].includes(id));
    const ids = documents.map(({ id }) => id);
    const fixtures = join(root, "fixtures");
    for (const document of documents) {
      const text = await readFile(join(repositoryRoot, document.runtimeTextRelativePath), "utf8");
      const line = text.split("\n").map((value) => value.trim()).find((value) => value.length >= 40);
      const unit = { label: "Unité test", stage: "inconnu", procedure: null, objet: null, page: 1,
        citation: line.slice(0, 120), anchor: line.slice(0, 20) };
      const answers = { "astra-pass1": { operations: [{ op: "add", reason: "r", unit }] },
        "fable-pass1": { operations: [] }, "gemini-pass1": { operations: [] }, "astra-pass2": { operations: [] },
        "fable-pass2": { operations: [] }, "gemini-pass2": { operations: [{ op: "correct", id: "u01", reason: "libellé",
          unit: { ...unit, label: "Unité test (Gemini 2)" } }] },
        "astra-pass3": { operations: [] },
        "converge-astra": { votes: [{ item: "i01", choice: "v1", reason: "vote sur l'ancien corrigé" }] } };
      for (const [step, answer] of Object.entries(answers)) {
        await mkdir(join(fixtures, step), { recursive: true });
        await writeFile(join(fixtures, step, `${document.id}.txt`), JSON.stringify(answer));
      }
    }
    const out = join(root, "out");
    const run = (stepId, docs = ids) => runStep({ stepId, docs, concurrency: 1, transport: `fake:${fixtures}`,
      chain: ["astra", "fable", "gemini"], out }, { repositoryRoot, log() {} });
    for (const step of ["astra-pass1", "fable-pass1", "gemini-pass1", "astra-pass2", "fable-pass2", "gemini-pass2"]) {
      assert.equal((await run(step)).done, 2, step);
    }
    assert.equal((await run("converge-astra")).notReady, 2, "verification waits for astra-pass3");
    // Simulate the verification votes cast before astra-pass3 existed (old chain): one vote file
    // plus the step summary.
    await mkdir(join(out, "annotations/converge-astra"), { recursive: true });
    await writeFile(join(out, "annotations/converge-astra", `${ids[0]}.json`), JSON.stringify({ items: [], votes: [] }));
    assert.deepEqual(await archiveStep({ outRoot: out, stepId: "converge-astra", suffix: "pre-pass3", reason: "test" }),
      { archivedAs: "converge-astra-pre-pass3", documents: 1, files: 2 });
    await assert.rejects(readFile(join(out, "annotations/converge-astra", `${ids[0]}.json`), "utf8"), /ENOENT/u);
    assert.equal((await run("astra-pass3")).done, 2);
    for (const documentId of ids) {
      const record = JSON.parse(await readFile(join(out, "annotations/astra-pass3", `${documentId}.json`), "utf8"));
      assert.equal(record.inputStateStep, "gemini-pass2", documentId);
      const gemini = JSON.parse(await readFile(join(out, "corrige/gemini-pass2", `${documentId}.json`), "utf8"));
      assert.equal(record.inputStateSha256, sha256(JSON.stringify(gemini)));
      assert.equal(activeUnits(gemini)[0].label, "Unité test (Gemini 2)");
    }
    const verification = await run("converge-astra");
    assert.deepEqual([verification.done, verification.skipped, verification.notReady], [2, 0, 0],
      "converge-astra skips nothing because of the archived votes");
    const log = JSON.parse(await readFile(join(out, "archive-converge-astra-pre-pass3.json"), "utf8"));
    assert.equal(log.files.length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("timedFetch cuts the socket: headers timeout, body idle timeout, total deadline; watchdog fails a stuck call", async () => {
  const closed = []; const sockets = new Set();
  const server = createServer((request, response) => {
    request.socket.on("close", () => closed.push(request.url));
    if (request.url === "/no-headers") return;                       // never answers
    if (request.url === "/stall") { response.writeHead(200, { "content-type": "text/event-stream" }); response.write("data: 1\n\n"); return; }
    if (request.url === "/trickle") {                                 // a chunk every 50 ms, forever
      response.writeHead(200, { "content-type": "text/event-stream" });
      const timer = setInterval(() => response.write("data: x\n\n"), 50); request.socket.on("close", () => clearInterval(timer)); return;
    }
    response.writeHead(200, { "content-type": "application/json" }); response.end("{\"ok\":true}");
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const waitClosed = async (path) => { for (let i = 0; i < 100 && !closed.includes(path); i += 1) await new Promise((r) => setTimeout(r, 20)); return closed.includes(path); };
  try {
    const ok = await timedFetch(`${base}/ok`, {}, { deadlineMs: 2_000, headersTimeoutMs: 1_000, idleTimeoutMs: 1_000 });
    assert.equal(ok.transcript, "{\"ok\":true}");
    let started = Date.now();
    await assert.rejects(timedFetch(`${base}/no-headers`, {}, { deadlineMs: 5_000, headersTimeoutMs: 150 }), { code: "HEADERS_TIMEOUT" });
    assert.ok(Date.now() - started < 1_500, "headers timeout fires on time");
    assert.ok(await waitClosed("/no-headers"), "the socket is really closed");
    started = Date.now();
    await assert.rejects(timedFetch(`${base}/stall`, {}, { deadlineMs: 5_000, headersTimeoutMs: 1_000, idleTimeoutMs: 150 }), { code: "IDLE_TIMEOUT" });
    assert.ok(Date.now() - started < 1_500);
    assert.ok(await waitClosed("/stall"));
    started = Date.now();
    await assert.rejects(timedFetch(`${base}/trickle`, {}, { deadlineMs: 300, headersTimeoutMs: 1_000, idleTimeoutMs: 1_000 }), { code: "DEADLINE_EXCEEDED" });
    assert.ok(Date.now() - started < 1_500, "a live but endless stream still stops at the deadline");
    assert.ok(await waitClosed("/trickle"));
    await assert.rejects(withWatchdog(new Promise(() => {}), 100), { code: "WATCHDOG_TIMEOUT" });
    assert.equal(await withWatchdog(Promise.resolve(7), 100), 7);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});

const scoringDocument = { id: "d", originalKey: "k", sha256: "s", sourceUrl: "u" };
const cite = (page, excerpt) => ({ source_file: "k", rawRef: "k", docSha: "s", sourceUrl: "u", modality: "pdf", page, excerpt });
const node = (id, stage, page, excerpt, extra = {}) => ({ id, node_type: "DesignationEvent", stage, citations: [cite(page, excerpt)], ...extra });

test("bounds: an unresolved item produced by an arm changes neither precision nor recall in strict; broad expects it", () => {
  const gold = [{ id: "g1", stage: "adoption", page: 2, anchor: "Règlement 2026-14", objet: "2026-14",
    citation: "QUE le conseil adopte le Règlement 2026-14 sur les usages conditionnels" }];
  const [neutral] = unresolvedUnits([{ documentId: "d", item: "a01", options: [
    { option: "v1", unit: { stage: "piia", page: 1, anchor: "1070, RUE BISSONNETTE", citation: "7.1 1070, RUE BISSONNETTE - PIIA lotissement", objet: "1070, rue Bissonnette" } },
    { option: "absent", unit: null }] }]);
  const without = { nodes: [node("a", "adoption", 2, "QUE le conseil adopte le Règlement 2026-14")], edges: [] };
  const withNeutral = { nodes: [...without.nodes, node("b", "piia", 1, "7.1 1070, RUE BISSONNETTE - PIIA lotissement")], edges: [] };
  const strict = (output) => aggregate([scoreCase({ state: "accepted", output }, scoringDocument, gold, { neutralUnits: [neutral] })]);
  assert.deepEqual([strict(withNeutral).precision, strict(withNeutral).recall], [strict(without).precision, strict(without).recall]);
  assert.equal(scoreCase({ state: "accepted", output: withNeutral }, scoringDocument, gold, { neutralUnits: [neutral] }).neutralized, 1);
  assert.equal(aggregate([scoreCase({ state: "accepted", output: withNeutral }, scoringDocument, gold, {})]).fp, 1,
    "without neutralisation the same detection is a false positive");
  const broad = aggregate([scoreCase({ state: "accepted", output: withNeutral }, scoringDocument, [...gold, neutral], {})]);
  assert.deepEqual([broad.tp, broad.fp, broad.fn], [2, 0, 0]);
  const missed = aggregate([scoreCase({ state: "accepted", output: without }, scoringDocument, [...gold, neutral], {})]);
  assert.deepEqual([missed.tp, missed.fn], [1, 1], "broad: an unresolved item not found is a miss");
  const tolerant = aggregate([scoreCase({ state: "accepted", output: { nodes: [node("c", "piia", 2, "QUE le conseil adopte le Règlement 2026-14")], edges: [] } },
    scoringDocument, gold, { stageTolerant: true })]);
  assert.equal(tolerant.tp, 1, "stage-tolerant: same anchored site, other stage");
  const twoStages = [{ id: "g1", stage: "avis_motion", page: 2, anchor: "Règlement 2026-14" }, { id: "g2", stage: "adoption", page: 2, anchor: "Règlement 2026-14" }];
  const one = aggregate([scoreCase({ state: "accepted", output: { nodes: [node("e", "piia", 2, "QUE le conseil adopte le Règlement 2026-14")], edges: [] } },
    scoringDocument, twoStages, { stageTolerant: true })]);
  assert.equal(one.tp, 1, "stage-tolerant: one detection credits one unit at most");
});

test("soft matching by character intervals: same page, stage and exact identifier; ROUGE-L never decides", () => {
  const page2 = pages[1];
  const gold = [{ id: "g1", stage: "adoption", page: 2, anchor: "Règlement 2026-14 sur les usages conditionnels", objet: "2026-14",
    citation: "QUE le conseil adopte le Règlement 2026-14 sur les usages conditionnels" }];
  const docPages = ["", page2];
  // The arm cut the same passage earlier: no anchor, same span region.
  const cut = { nodes: [node("a", "adoption", 2, "QUE le conseil adopte le Règlement 2026-14")], edges: [] };
  assert.equal(scoreCase({ state: "accepted", output: cut }, scoringDocument, gold, {}).tp, 0, "exact matching misses the cut citation");
  const soft = scoreCase({ state: "accepted", output: cut }, scoringDocument, gold, { softMatcher: softMatcherFor(docPages) });
  assert.deepEqual([soft.tp, soft.softOnly], [1, 1]);
  // Same words elsewhere on the page do not overlap: never credited, whatever ROUGE-L says.
  const elsewhere = { nodes: [node("b", "adoption", 2, "2026-05 modifiant le Règlement de zonage 2014-05")], edges: [] };
  assert.equal(scoreCase({ state: "accepted", output: elsewhere }, scoringDocument, gold, { softMatcher: softMatcherFor(docPages) }).tp, 0);
  assert.equal(scoreCase({ state: "accepted", output: { nodes: [node("c", "adoption", 1, "QUE le conseil adopte le Règlement 2026-14")], edges: [] } },
    scoringDocument, gold, { softMatcher: softMatcherFor(docPages) }).tp, 0, "another page is never the same passage");
  // Distinct acts with the same identity and page but disjoint spans: high ROUGE-L, no overlap.
  const twin = ["", "7.1 PIIA 1070, rue Bissonnette : rénovation du bâtiment principal\n7.2 PIIA 1070, rue Bissonnette : rénovation du bâtiment accessoire\n"];
  const unitAt = (citation) => ({ stage: "piia", objet: "1070, rue Bissonnette", page: 2, citation });
  const main = unitAt("7.1 PIIA 1070, rue Bissonnette : rénovation du bâtiment principal");
  const accessory = unitAt("7.2 PIIA 1070, rue Bissonnette : rénovation du bâtiment accessoire");
  assert.ok(rougeL(main.citation, accessory.citation) > 0.8);
  assert.equal(spanOverlap(main, accessory, twin), 0);
  assert.ok(!softEquivalent(main, accessory, twin), "ROUGE-L 0.8+ but disjoint spans: two acts");
  const shorter = unitAt("PIIA 1070, rue Bissonnette : rénovation du bâtiment principal");
  assert.ok(spanOverlap(main, shorter, twin) >= MIN_OVERLAP_CHARS && softEquivalent(main, shorter, twin));
  assert.ok(!softEquivalent(main, { ...shorter, objet: "1072, rue Bissonnette" }, twin), "identifier strictly equal");
  assert.ok(!softEquivalent(main, { ...shorter, stage: "derogation_mineure" }, twin), "same stage");
});

test("soft merge replaces arbitration only when the three votes chose overlapping present versions", () => {
  const twin = ["", "7.1 PIIA 1070, rue Bissonnette : rénovation du bâtiment principal\n7.2 PIIA 1070, rue Bissonnette : rénovation du bâtiment accessoire\n"];
  const unitAt = (citation) => ({ stage: "piia", objet: "1070, rue Bissonnette", page: 2, citation });
  const options = [{ option: "v1", unit: unitAt("7.1 PIIA 1070, rue Bissonnette : rénovation du bâtiment principal") },
    { option: "v2", unit: unitAt("PIIA 1070, rue Bissonnette : rénovation du bâtiment principal") },
    { option: "v3", unit: unitAt("7.2 PIIA 1070, rue Bissonnette : rénovation du bâtiment accessoire") },
    { option: "absent", unit: null }];
  const entry = (a, b, c) => ({ options, votes: { astra: vote("i", a), fable: vote("i", b), gemini: vote("i", c) } });
  assert.deepEqual(softMerge(entry("v1", "v2", "v2"), twin), { outcome: "merged", choice: "v2", tally: { v1: 1, v2: 2 }, rule: "intervals" });
  assert.equal(softMerge(entry("v1", "v2", "v1"), twin).choice, "v1");
  assert.equal(softMerge(entry("v1", "v2", "absent"), twin), null, "an absent vote is a real disagreement");
  assert.equal(softMerge(entry("v1", "v3", "v1"), twin), null, "disjoint spans: arbitration, even with ROUGE-L 0.8+");
  assert.equal(softMerge(entry("v1", "v2", "v2"), null), null);
});

test("precision cascade: acts are the scorer's groups; Gemini can only remove, never add", async () => {
  const documentId = "saint-etienne-de-bolton-2026-08-04";
  const source = JSON.parse(await readFile(join(repositoryRoot, SOURCE_DIR, `${documentId}--astra-low.attempt-1.output.json`), "utf8"));
  const manifest = JSON.parse(await readFile(join(repositoryRoot, "docs/reviews/refresh-benchmark/v101b/manifest.json"), "utf8"));
  const document = manifest.documents.find(({ id }) => id === documentId);
  const docPages = documentPages(await readFile(join(repositoryRoot, document.runtimeTextRelativePath), "utf8"));
  const acts = actsOf(source);
  assert.equal(acts.length, scoreValidV2(source, document, []).candidateGroups, "one act per scored group");
  assert.ok(acts.length >= 3);
  const decisions = [
    { act: acts[0].act, verdict: "non_soutenu", reason: "rappel historique", excerpt: "" },
    { act: acts[1].act, verdict: "non_soutenu", reason: " " },                    // no reason: kept
    { act: "A99", verdict: "non_soutenu", reason: "inconnu" },                      // unknown id: ignored
    { act: acts[2].act, verdict: "soutenu", reason: "attesté", excerpt: "texte absent du document, inventé" },
    { act: "A100", verdict: "soutenu", reason: "ajout", node: { id: "new", node_type: "Signal" } },
  ];
  const { filtered, log } = applyDecisions(source, acts, decisions, docPages);
  const sourceIds = new Set(source.nodes.map(({ id }) => id));
  assert.ok(filtered.nodes.every(({ id }) => sourceIds.has(id)), "no node is ever added");
  assert.equal(filtered.nodes.length, source.nodes.length - acts[0].nodeIds.length);
  assert.deepEqual(log.removed.map(({ act }) => act), [acts[0].act]);
  assert.deepEqual(log.unknownIds, ["A99", "A100"]);
  assert.equal(log.supportedUngrounded, 1);
  assert.equal(log.keptNoValidDecision, acts.length - 2);
  assert.ok(scoreValidV2(filtered, document, []).candidateGroups === acts.length - 1);
  // End to end on a canned answer, into a temporary directory.
  const root = await mkdtemp(join(tmpdir(), "precision-cascade-"));
  try {
    await writeFile(join(root, `${documentId}.txt`), JSON.stringify({ decisions: decisions.slice(0, 1) }));
    const summary = await runCascade({ repositoryRoot, docs: [documentId], concurrency: 1, transport: `fake:${root}`,
      out: join(root, "out"), log() {} });
    assert.deepEqual([summary.done, summary.failed], [1, 0]);
    const receipt = JSON.parse(await readFile(join(root, "out/campaign", `${documentId}--precision-astra-low-gemini-low.attempt-1.receipt.json`), "utf8"));
    assert.equal(receipt.validation.accepted, true);
    assert.equal((await runCascade({ repositoryRoot, docs: [documentId], concurrency: 1, transport: `fake:${root}`,
      out: join(root, "out"), log() {} })).skipped, 1, "resumable");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("precision cascade families: A rule, B document, C both or none - never split", async () => {
  const { familyOf } = await import("./precision-cascade-families.mjs");
  assert.equal(familyOf("La vente d'immeubles pour non-paiement de taxes relève de la fiscalité et des exclusions."), "A");
  assert.equal(familyOf("Le règlement 225 est uniquement cité en tant que règlement faisant l'objet d'une modification."), "B");
  assert.equal(familyOf("Contrat de services professionnels, sans acte d'urbanisme."), "C", "both families match: C");
  assert.equal(familyOf("Motif sans rapport."), "C", "no family matches: C");
});
