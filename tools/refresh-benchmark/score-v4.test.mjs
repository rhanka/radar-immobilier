import assert from "node:assert/strict";
import test from "node:test";

import { citationHealth, scoreLegacy } from "./score-v4.mjs";

const document = { id: "complete", sha256: "sha", originalKey: "raw/doc.pdf",
  sourceUrl: "https://x/doc.pdf", pageCount: 1 };
const gold = [{ id: "A", stage: "adoption", page: 1, anchor: "adopte le règlement" }];

test("legacy scoring requires the frozen stage, page, and anchor", () => {
  const finding = { etape: "adoption", page: 1, citation: "Le conseil adopte le règlement 42" };
  assert.deepEqual(scoreLegacy([finding], document, gold), {
    oracleUnits: 1, findings: 1, matchedIds: ["A"], tp: 1, fp: 0, fn: 0,
    precision: 1, recall: 1, partialOracle: false,
  });
  assert.equal(scoreLegacy([{ ...finding, page: 2 }], document, gold).tp, 0);
  assert.equal(scoreLegacy([{ ...finding, etape: "avis_motion" }], document, gold).tp, 0);
});

test("citation health checks full identity, physical page, and verbatim excerpt", () => {
  const citation = { source_file: document.originalKey, rawRef: document.originalKey,
    docSha: document.sha256, sourceUrl: document.sourceUrl, modality: "pdf", page: 1,
    excerpt: "Le conseil adopte le règlement 42" };
  const output = { nodes: [{ citations: [citation] }], edges: [], evidence: [] };
  assert.deepEqual(citationHealth(output, document, ["Avant. Le conseil adopte le règlement 42. Après."]),
    { records: 1, exactIdentity: 1, physicalPage: 1, verbatimExcerpt: 1 });
  assert.equal(citationHealth({ ...output, nodes: [{ citations: [{ ...citation,
    sourceUrl: "https://wrong" }] }] }, document, [citation.excerpt]).exactIdentity, 0);
});
