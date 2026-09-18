import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { activeUnits, applyOperations, applyResolutions, calibrationMatch, disputesOf, emptyState,
  groundUnit, isDuplicate, keysCompatible, loadPrompts, objectKey, pairOneToOne, parseJsonObject,
  passUserMessage, resolveVotes, STEPS } from "./oracle-v3-lib.mjs";
import { chainSteps, createTransport, previousPassStep, runStep } from "./oracle-v3-step.mjs";
import { aggregate, scoreCase } from "./score-oracle-v3.mjs";
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

test("disputes, votes and resolution: 2 of 3 wins, 3 different choices stay unresolved", () => {
  let { state } = applyOperations(emptyState("d"), [
    { op: "add", unit: unit({}), reason: "adoption" },
    { op: "add", unit: unit({ stage: "avis_motion" }), reason: "avis" },
    { op: "add", unit: unit({ stage: "projet_reglement" }), reason: "projet" },
  ], pages, "astra-pass1");
  ({ state } = applyOperations(state, [
    { op: "remove", id: "u02", reason: "rappel historique" },
    { op: "correct", id: "u03", unit: unit({ stage: "second_projet" }), reason: "second projet" },
  ], pages, "gemini-pass1"));
  const disputes = disputesOf(state);
  assert.deepEqual(disputes.map(({ unitId, current, options }) =>
    `${unitId}:${current}:${options.map(({ option }) => option).join("/")}`), ["u02:absent:v1/absent", "u03:v2:v1/v2/absent"]);
  const restore = resolveVotes(disputes[0], { astra: { choice: "v1" }, fable: { choice: "v1" }, gemini: { choice: "absent" } });
  assert.deepEqual([restore.outcome, restore.choice, restore.changed], ["resolved", "v1", true]);
  const split = resolveVotes(disputes[1], { astra: { choice: "v1" }, fable: { choice: "v2" }, gemini: { choice: "absent" } });
  assert.deepEqual([split.outcome, split.choice, split.changed], ["unresolved", "v2", false]);
  const invalid = resolveVotes(disputes[1], { astra: { choice: "v7" }, fable: { choice: "v1" }, gemini: null });
  assert.equal(invalid.outcome, "unresolved");
  const final = applyResolutions(state, disputes, { d01: restore, d02: split });
  assert.deepEqual(activeUnits(final).map(({ id, stage }) => `${id}:${stage}`),
    ["u01:adoption", "u02:avis_motion", "u03:second_projet"]);
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
  assert.deepEqual(STEPS.map(({ id }) => id), ["astra-pass1", "astra-pass2", "fable-pass1", "fable-pass2",
    "gemini-pass1", "gemini-pass2", "converge-astra", "converge-fable", "converge-gemini"]);
  assert.equal(previousPassStep("astra-pass1", ["astra", "fable", "gemini"]), null);
  assert.equal(previousPassStep("fable-pass1", ["astra", "fable", "gemini"]).id, "astra-pass2");
  assert.equal(previousPassStep("converge-fable", ["astra", "fable", "gemini"]).id, "gemini-pass2");
  assert.equal(chainSteps(["fable", "gemini"])[0].id, "fable-pass1");
  const saved = { go: process.env.ORACLE_V3_GO, astra: process.env.ORACLE_V3_ASTRA_GO };
  delete process.env.ORACLE_V3_GO; delete process.env.ORACLE_V3_ASTRA_GO;
  await assert.rejects(createTransport(STEPS[2], null), /ORACLE_V3_GO=1/u);
  process.env.ORACLE_V3_GO = "1";
  await assert.rejects(createTransport(STEPS[0], null), /ORACLE_V3_ASTRA_GO=1/u);
  if (saved.go === undefined) delete process.env.ORACLE_V3_GO; else process.env.ORACLE_V3_GO = saved.go;
  if (saved.astra !== undefined) process.env.ORACLE_V3_ASTRA_GO = saved.astra;
});

test("prompts: both blocks load; the pass message carries the current gold without history", async () => {
  const prompts = await loadPrompts(repositoryRoot);
  assert.match(prompts.pass.text, /Mentions historiques du même dossier ne multiplient pas le rappel/u);
  assert.match(prompts.converge.text, /"votes"/u);
  const { state } = applyOperations(emptyState("d"), [{ op: "add", unit: unit({}), reason: "adoption" }], pages, "astra-pass1");
  const message = passUserMessage({ id: "d", city: "c", date: "2026-01-01" }, pages, activeUnits(state));
  assert.match(message, /"id": "u01"/u); assert.doesNotMatch(message, /astra-pass1|reason/u);
  assert.match(message, /=== PAGE 2 ===/u);
  assert.deepEqual(parseJsonObject("```json\n{\"operations\":[]}\n```"), { operations: [] });
});

test("end to end on canned answers: 6 passes, 3 votes, no network", async () => {
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
      "gemini-pass2": { operations: [] },
      "converge-astra": { votes: [{ dispute: "d01", choice: "v1", reason: "prévu à l'ordre du jour" }] },
      "converge-fable": { votes: [{ dispute: "d01", choice: "v1", reason: "prévu à l'ordre du jour" }] },
      "converge-gemini": { votes: [{ dispute: "d01", choice: "absent", reason: "x" }] },
    };
    const text = await readFile(join(repositoryRoot, document.runtimeTextRelativePath), "utf8");
    const line = text.split("\n").find((value) => /Avis de motion/u.test(value)).trim();
    answers["astra-pass1"].operations[0].unit.citation = line.slice(0, 120);
    for (const [step, answer] of Object.entries(answers)) {
      await mkdir(join(fixtures, step), { recursive: true });
      await writeFile(join(fixtures, step, `${document.id}.txt`), JSON.stringify(answer));
    }
    const out = join(root, "out");
    for (const { id } of STEPS) {
      const summary = await runStep({ stepId: id, docs: [document.id], concurrency: 1,
        transport: `fake:${fixtures}`, chain: ["astra", "fable", "gemini"], out }, { repositoryRoot, log() {} });
      assert.equal(summary.done, 1, id);
    }
    const again = await runStep({ stepId: "fable-pass1", docs: [document.id], concurrency: 1,
      transport: `fake:${fixtures}`, chain: ["astra", "fable", "gemini"], out }, { repositoryRoot, log() {} });
    assert.equal(again.skipped, 1, "resumable: an existing output is never recomputed");
    const gemini = JSON.parse(await readFile(join(out, "corrige/gemini-pass2", `${document.id}.json`), "utf8"));
    assert.equal(activeUnits(gemini).length, 0);
    const disputes = disputesOf(gemini);
    const votes = Object.fromEntries(await Promise.all(["astra", "fable", "gemini"].map(async (family) => [family,
      JSON.parse(await readFile(join(out, "annotations", `converge-${family}`, `${document.id}.json`), "utf8")).votes[0]])));
    const resolution = resolveVotes(disputes[0], votes);
    assert.deepEqual([resolution.outcome, resolution.choice], ["resolved", "v1"]);
    assert.equal(activeUnits(applyResolutions(gemini, disputes, { d01: resolution })).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
