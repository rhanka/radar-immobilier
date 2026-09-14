import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { scoreValid } from "./score-v3.mjs";
import { ORACLE_V2_ELIGIBLE_NODE_TYPES, scoreValidV2, stripItemNumber } from "./score-oracle-v2.mjs";

const repositoryRoot = process.env.BENCHMARK_REPOSITORY_ROOT
  ?? resolve(import.meta.dirname, "../..");
const document = { id: "valcourt-2026-06-01-agenda",
  originalKey: "raw/pv/cas/aa.pdf", sha256: "a".repeat(64), sourceUrl: "https://example.test/aa.pdf" };
const identity = { source_file: document.originalKey, rawRef: document.originalKey,
  docSha: document.sha256, sourceUrl: document.sourceUrl, modality: "pdf" };
const node = (id, type, stage, page, excerpt) => ({ id, node_type: type, stage,
  citations: [{ ...identity, page, excerpt }] });

test("strips agenda item numbering but never a resolution number", () => {
  assert.equal(stripItemNumber("7.1 1070, rue bissonnette"), "1070, rue bissonnette");
  assert.equal(stripItemNumber("13.2 4111 rue carpentier"), "4111 rue carpentier");
  assert.equal(stripItemNumber("3.6 avis de motion"), "avis de motion");
  // A resolution number carries no whitespace right after its first digit run, so it is kept.
  assert.equal(stripItemNumber("2026-08-155 il est proposé"), "2026-08-155 il est proposé");
  assert.equal(stripItemNumber("2026-04 modifiant le"), "2026-04 modifiant le");
});

test("R1 matches an excerpt that starts after the item number, where v1 does not", () => {
  const gold = [{ id: "V71", stage: "piia", page: 1, anchor: "7.1 1070, RUE BISSONNETTE" }];
  const output = { nodes: [node("n1", "DesignationEvent", "piia", 1,
    "1070, RUE BISSONNETTE - PIIA BOISÉ DU RUISSEAU - LOTISSEMENT")], edges: [] };
  assert.equal(scoreValid(output, document, gold).tp, 0);
  assert.equal(scoreValidV2(output, document, gold).tp, 1);
});

test("R1 still matches an excerpt that keeps the item number", () => {
  const gold = [{ id: "V71", stage: "piia", page: 1, anchor: "7.1 1070, RUE BISSONNETTE" }];
  const output = { nodes: [node("n1", "DesignationEvent", "piia", 1,
    "7.1 1070, RUE BISSONNETTE - PIIA BOISÉ DU RUISSEAU")], edges: [] };
  assert.equal(scoreValid(output, document, gold).tp, 1);
  assert.equal(scoreValidV2(output, document, gold).tp, 1);
});

test("R2 credits a Bylaw node and counts it in the precision denominator", () => {
  const gold = [{ id: "B14", stage: "adoption", page: 11, anchor: "adopte le Règlement 2026-14" }];
  const output = { nodes: [node("b1", "Bylaw", "adoption", 11, "QUE le conseil adopte le Règlement 2026-14"),
    node("b2", "Bylaw", "adoption", 11, "un passage sans unité oracle correspondante")], edges: [] };
  const v1 = scoreValid(output, document, gold);
  const v2 = scoreValidV2(output, document, gold);
  assert.equal(v1.tp, 0);
  assert.equal(v1.candidateGroups, 0);
  assert.equal(v2.tp, 1);
  // The unmatched Bylaw is a false positive: admitting the type is not a free gain.
  assert.equal(v2.candidateGroups, 2);
  assert.equal(v2.fp, 1);
  assert.equal(v2.precision, 0.5);
});

test("R3 uses an alternate site only when the unit declares one", () => {
  const gold = [{ id: "B04", stage: "adoption", page: 2, anchor: "2026-04 modifiant le",
    alternate_sites: [{ page: 10, anchor: "2026-04 modifiant le" }] }];
  const output = { nodes: [node("b1", "Bylaw", "adoption", 10,
    "2026-04 modifiant le Règlement de plan d’urbanisme 2014-04 ;")], edges: [] };
  assert.equal(scoreValidV2(output, document, gold, { useAlternateSites: false }).tp, 0);
  assert.equal(scoreValidV2(output, document, gold).tp, 1);
});

test("v2 keeps the v1 stage gate and the v1 PDF identity gate", () => {
  const gold = [{ id: "V71", stage: "piia", page: 1, anchor: "1070, RUE BISSONNETTE" }];
  const wrongStage = { nodes: [node("n1", "DesignationEvent", "adoption", 1, "1070, RUE BISSONNETTE")], edges: [] };
  assert.equal(scoreValidV2(wrongStage, document, gold).tp, 0);
  const wrongIdentity = { nodes: [{ id: "n1", node_type: "DesignationEvent", stage: "piia",
    citations: [{ ...identity, docSha: "b".repeat(64), page: 1, excerpt: "1070, RUE BISSONNETTE" }] }], edges: [] };
  assert.equal(scoreValidV2(wrongIdentity, document, gold).tp, 0);
});

test("the published v2 oracle adds sites, never units, and is derived from the frozen v1", async () => {
  const v1Bytes = await readFile(resolve(repositoryRoot,
    "docs/reviews/refresh-benchmark/v13/manual-oracle.json"));
  const v1 = JSON.parse(v1Bytes.toString("utf8"));
  const v2 = JSON.parse(await readFile(resolve(repositoryRoot,
    "docs/reviews/refresh-benchmark/manual-oracle-v2.json"), "utf8"));
  assert.equal(v2.derivedFrom.sha256, createHash("sha256").update(v1Bytes).digest("hex"));
  assert.equal(v2.units.length, v1.units.length);
  assert.equal(v2.realignment.addedUnits, 0);
  assert.deepEqual(v2.realignment.eligibleNodeTypes, [...ORACLE_V2_ELIGIBLE_NODE_TYPES]);
  const frozenById = new Map(v1.units.map((unit) => [unit.id, unit]));
  for (const unit of v2.units) {
    const frozen = frozenById.get(unit.id);
    assert.ok(frozen, `unknown unit ${unit.id}`);
    // Every frozen field is carried over untouched; v2 only ever adds alternate_sites.
    for (const [field, value] of Object.entries(frozen)) assert.deepEqual(unit[field], value);
    for (const site of unit.alternate_sites ?? []) {
      assert.ok(Number.isInteger(site.page) && site.page >= 1);
      assert.ok(typeof site.provenance?.text === "string" && site.provenance.text.length > 0);
      assert.ok(site.provenance.text.includes(site.anchor) || site.anchor === frozen.anchor);
    }
  }
});
