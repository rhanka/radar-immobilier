import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { arms, laneArms, receiptCap, usageCostUsd } from "./v101-arms.mjs";
import { artifactPaths, classifyFailure, resumeDecision, retryAt, updateGlobalStatus,
  writeImmutable, writeIntent } from "./v101-runner-state.mjs";
import { cascade, discardDirect } from "./v101-score-lib.mjs";

test("should enumerate every addressable arm when Codex 5.3 is unavailable", () => {
  assert.equal(Object.keys(arms).length, 26);
  assert.deepEqual(Object.fromEntries(Object.entries(laneArms).map(([key, value]) =>
    [key, value.length])), { cloud: 6, codex: 12, openai: 1, anthropic: 6, mistral: 1 });
});

test("should calculate metered cost from normalized usage", () => {
  assert.equal(usageCostUsd(arms.gpt41, { inputTokens: 2_000_000, outputTokens: 700_000 }), 9.6);
  assert.equal(usageCostUsd(arms["sol-low"], { inputTokens: 1, outputTokens: 1 }), null);
});

test("should enforce the Codex cap under llm-mesh 0.19.3", () => {
  assert.deepEqual(receiptCap(arms["luna-low"], { outputTokens: 32_768 }), {
    requested: 32_768,
    enforced: true,
    reason: null,
    observedOutputTokens: 32_768,
    classification: "within-observed-cap",
  });
  assert.equal(Object.values(arms).filter(({ lane }) => lane === "codex")
    .every(({ capEnforced }) => capEnforced), true);
});

test("should retry only transport classes and suspend a 429", () => {
  assert.equal(classifyFailure({ httpStatus: 500 }).retry, true);
  assert.equal(classifyFailure({ httpStatus: 425 }).retry, true);
  assert.equal(classifyFailure({ code: "ENOTFOUND" }).retry, true);
  assert.equal(classifyFailure({ terminalSse: { expected: true, terminal: false } }).retry, true);
  assert.deepEqual(classifyFailure({ httpStatus: 429 }),
    { category: "rate-limit", retry: false, suspend: true });
  assert.equal(classifyFailure({ code: "REQUEST_BUDGET_SUSPENDED" }).suspend, true);
  assert.equal(classifyFailure({ httpStatus: 400 }).retry, false);
  assert.equal(classifyFailure({ httpStatus: 200 }).retry, false);
});

test("should parse provider reset headers without inventing an absent reset", () => {
  assert.equal(retryAt({ "retry-after": "2" }, 0), "1970-01-01T00:00:02.000Z");
  assert.equal(retryAt({ "x-ratelimit-reset-requests": "1500ms" }, 0),
    "1970-01-01T00:00:01.500Z");
  assert.equal(retryAt({}, 0), null);
});

test("should claim before work, preserve receipts, and fail closed on uncertain intent", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "v101-runner-"));
  try {
    const paths = artifactPaths(root, "doc-a", "gpt41", 1);
    assert.equal((await resumeDecision(root, "doc-a", "gpt41")).attempt, 1);
    assert.equal(await writeIntent(paths, { state: "in-flight" }), true);
    await assert.rejects(() => resumeDecision(root, "doc-a", "gpt41"), /Uncertain in-flight/u);
    await writeImmutable(paths.receipt, { status: "completed", retry: { eligible: false } });
    assert.equal((await resumeDecision(root, "doc-a", "gpt41")).action, "skip");
    await assert.rejects(() => writeImmutable(paths.receipt, {}), { code: "EEXIST" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("should update one global status file atomically", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "v101-status-"));
  try {
    const path = resolve(root, "status.json");
    await Promise.all(["gpt41", "mistral-small4"].map((name) =>
      updateGlobalStatus(path, name, () => ({ processed: 1 }), () => 1_000)));
    const status = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(Object.keys(status.arms).sort(), ["gpt41", "mistral-small4"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("should discard one direct C-prime target and clean dangling support", () => {
  const extraction = { nodes: [
    { id: "n1", node_type: "Signal", citations: [{ excerpt: "bad" }], evidence_refs: ["e1"] },
    { id: "n2", node_type: "Zone", citations: [{ excerpt: "kept" }] }],
  edges: [{ source: "n1", target: "n2", relation: "concerns", citations: [{ excerpt: "kept" }],
    evidence_refs: ["e1"] }], evidence: [{ id: "e1" }] };
  assert.equal(discardDirect(extraction, "evidence[0]").id, "e1");
  assert.deepEqual(cascade(extraction, new Set(["Signal"])).map(({ kind }) => kind),
    ["node", "edge"]);
});
