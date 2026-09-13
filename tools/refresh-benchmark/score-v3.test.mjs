import assert from "node:assert/strict";
import test from "node:test";

import { classifyReceipt, scoreValid } from "./score-v3.mjs";

test("classifies only accepted completion as quality-scorable", () => {
  assert.equal(classifyReceipt({ status: "completed", extractionAccepted: true }), "completed_valid");
  assert.equal(classifyReceipt({ status: "failed", actual: { id: "response" } }), "completed_invalid");
  assert.equal(classifyReceipt({ status: "failed", actual: null }), "transport_failed");
  assert.equal(classifyReceipt(), "not_launched");
});

test("matches only exact frozen anchor, stage, page and PDF identity", () => {
  const document = { id: "complete", sha256: "sha", originalKey: "raw/doc.pdf", sourceUrl: "https://x/doc.pdf" };
  const citation = { source_file: document.originalKey, rawRef: document.originalKey,
    docSha: document.sha256, sourceUrl: document.sourceUrl, modality: "pdf", page: 3,
    excerpt: "Le conseil adopte le Règlement 26-956-2 tel que soumis" };
  const output = { nodes: [{ id: "event", node_type: "DesignationEvent", etape: "adoption",
    citations: [citation] }, { id: "signal", node_type: "Signal", etape: "adoption",
    citations: [citation] }], edges: [{ source: "event", target: "signal", relation: "raises_signal" }], evidence: [] };
  const gold = [{ id: "W001", stage: "adoption", page: 3,
    anchor: "adopte le Règlement 26-956-2" }];
  assert.deepEqual(scoreValid(output, document, gold), { oracleUnits: 1, typedNodes: 2,
    matchedTypedNodes: 2, unmatchedTypedNodes: 0, nodePrecision: 1, matchedIds: ["W001"],
    missedIds: [], oracleRecall: 1, partialOracle: false, raisesSignalRelations: 1 });
  assert.equal(scoreValid(output, document, [{ ...gold[0], page: 2 }]).matchedIds.length, 0);
  assert.equal(scoreValid(output, document,
    [{ ...gold[0], stage: "projet_reglement" }]).matchedIds.length, 0);
});
