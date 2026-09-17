import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { arms, laneArms, receiptCap, usageCostUsd } from "./v101-arms.mjs";
import { advanceCircuit, artifactPaths, classifyFailure, laneCircuitAction, laneConcurrency,
  providerGatePassed,
  rateLimitPlan, receiptAttemptOrder, releaseRateLimitIntent, replayTransportGatePassed,
  resetRateLimitState,
  resumeDecision, retryAt, updateGlobalStatus, writeImmutable, writeIntent }
  from "./v101-runner-state.mjs";
import { cascade, discardDirect } from "./v101-score-lib.mjs";
import { cliUsage, codexCapOption, directRequest } from "./v101-provider.mjs";
import { armExecutionRoot } from "./score-v101.mjs";
import { timeoutMsForArm } from "./run-arm.mjs";
import { circuitClosureFor, selectJudgeDocuments } from "./v101-judge-freeze.mjs";
import { judgeConfig, judgeMessages } from "./v101-judge-run.mjs";
import { acceptanceAdjustedF1, summarizeJudgeVerdicts, summarizeReceipts }
  from "./v101-report.mjs";
import { microF1 } from "./v101-score-lib.mjs";

test("should enumerate every addressable arm when Codex 5.3 is unavailable", () => {
  assert.equal(Object.keys(arms).length, 27);
  assert.deepEqual(Object.fromEntries(Object.entries(laneArms).map(([key, value]) =>
    [key, value.length])), { cloud: 6, codex: 12, openai: 1, anthropic: 6, mistral: 1, claude: 1 });
});

test("should filter documents after the frozen slice when requested", () => {
  const runnerSource = readFileSync(new URL("./run-arm.mjs", import.meta.url), "utf8");
  assert.match(runnerSource, /BENCHMARK_DOCUMENT_IDS/u);
  assert.match(runnerSource, /slicedDocuments\.filter\(\(document\) => selectedDocumentIds\.has\(document\.id\)\)/u);
});

test("should keep lane concurrency defaults and accept a bounded override", () => {
  assert.equal(laneConcurrency("anthropic", false, ""), 1);
  assert.equal(laneConcurrency("codex", true, ""), 2);
  assert.equal(laneConcurrency("anthropic", false, "3"), 3);
  assert.throws(() => laneConcurrency("codex", true, "3"), /between 1 and 2/u);
});

test("should extend only xhigh transport timeouts", () => {
  assert.equal(timeoutMsForArm(arms["luna-high"]), 480_000);
  assert.equal(timeoutMsForArm(arms["luna-xhigh"]), 900_000);
});

test("should score v101b Codex receipts from the isolated replay root", () => {
  assert.equal(armExecutionRoot("/results", "v101b", arms["sol-low"]),
    "/results/codex-replay");
  assert.equal(armExecutionRoot("/results", "v101b", arms["gemini-low"]), "/results");
  assert.equal(armExecutionRoot("/results", "v101", arms["sol-low"]), "/results");
});

test("should freeze a verdict-independent 8/8/8/1 judge sample", () => {
  const documents = ["S", "M", "L", "ancre"].flatMap((sizeBucket) =>
    Array.from({ length: 10 }, (_, index) => ({ id: `${sizeBucket}-${index}`, sizeBucket })));
  const sample = selectJudgeDocuments(documents);
  assert.deepEqual(Object.fromEntries(["S", "M", "L", "ancre"].map((bucket) =>
    [bucket, sample.filter(({ sizeBucket }) => sizeBucket === bucket).length])),
  { S: 8, M: 8, L: 8, ancre: 1 });
});

test("should keep model identity out of blind judge messages", () => {
  assert.equal(judgeConfig("judge-terra").model, "gpt-5.6-terra");
  assert.equal(judgeConfig("judge-opus46-thinking").model, "claude-opus-4-6-thinking");
  const messages = judgeMessages({ judgeInstructions: ["Evaluate."] },
    { alias: "unit-opaque", extraction: {} },
    { pages: [{ page: 1, text: "Municipal record." }] });
  assert.equal(JSON.stringify(messages).includes("gpt-5.6-terra"), false);
  assert.equal(JSON.stringify(messages).includes("claude-opus"), false);
});

test("should select the newest terminal replay attempt for judging", async () => {
  const source = await readFile(new URL("./v101-judge-freeze.mjs", import.meta.url), "utf8");
  assert.match(source, /for \(const attempt of \[4, 3, 2, 1\]\)/u);
  assert.match(source, /if \(!terminalRecord\) continue/u);
});

test("should require an explicit cause before judging a circuit-closed gap", () => {
  assert.deepEqual(circuitClosureFor({ arms: { "sonnet46-cloud-high": {
    cause: "network_error", measuredAt: "2026-09-16T04:00:00Z" } } },
  "sonnet46-cloud-high"), { cause: "network_error", measuredAt: "2026-09-16T04:00:00Z" });
  assert.throws(() => circuitClosureFor({ arms: {} }, "sonnet46-cloud-high"),
    /No measured circuit closure/u);
});

test("should materialize Terra medium effort in the direct OpenAI request", () => {
  const request = directRequest(judgeConfig("judge-terra"), [{ role: "user", content: "x" }], 32_768);
  assert.deepEqual(request.body.reasoning, { effort: "medium" });
  assert.equal(request.body.max_output_tokens, 32_768);
});

test("should normalize Claude CLI JSON usage", () => {
  assert.deepEqual(cliUsage({ usage: { input_tokens: 12, output_tokens: 4 } }),
    { inputTokens: 12, outputTokens: 4, totalTokens: 16 });
});

test("should calculate metered cost from normalized usage", () => {
  assert.equal(usageCostUsd(arms.gpt41, { inputTokens: 2_000_000, outputTokens: 700_000 }), 9.6);
  assert.equal(usageCostUsd(arms["sol-low"], { inputTokens: 1, outputTokens: 1 }), null);
});

test("should summarize terminal receipts by failure class", () => {
  const base = { attemptNumber: 1, latency: { totalMs: 1_000 }, cap: {},
    actual: { usage: { inputTokens: 100, outputTokens: 20 } } };
  const metrics = summarizeReceipts([
    { ...base, documentId: "accepted", status: "completed",
      validation: { accepted: true, layers: { json: { valid: true }, v9: {} } } },
    { ...base, documentId: "json", status: "completed", latency: { totalMs: 3_000 },
      validation: { accepted: false, layers: { json: { valid: false }, v9: {} } } },
    { ...base, documentId: "provenance", status: "completed", latency: { totalMs: 2_000 },
      validation: { accepted: false, layers: { json: { valid: true },
        v9: { error: "ungrounded PDF excerpt" } } } },
    { ...base, documentId: "transport", status: "failed", actual: null,
      error: { category: "network" }, validation: { accepted: false, layers: {} } },
  ], arms.gpt41, 2);
  assert.deepEqual(metrics, { processed: 4, accepted: 1, transportReplayed: 0,
    transport: 1, rateLimit: 2,
    json: 1, profile: 0, provenance: 1, budget: 0, latencyP50Ms: 1_000,
    latencyP95Ms: 3_000, inputTokens: 300, outputTokens: 60, costUsd: 0.00108 });
});

test("should report transport replays and acceptance-adjusted F1", () => {
  const base = { documentId: "replayed", status: "failed", attemptNumber: 2,
    latency: { totalMs: 1, startedAt: "2026-09-16T15:00:00Z" },
    error: { category: "network" }, actual: null,
    validation: { accepted: false, layers: {} } };
  const replayed = { ...base, status: "completed", attemptNumber: 3, error: null,
    latency: { totalMs: 1, startedAt: "2026-09-16T19:40:00Z" },
    actual: { usage: { inputTokens: 1, outputTokens: 1 } },
    validation: { accepted: true, layers: { json: { valid: true }, v9: {} } } };
  assert.equal(summarizeReceipts([base, replayed], arms["sonnet5-off"], 0,
    "2026-09-16T19:36:00Z").transportReplayed, 1);
  assert.equal(acceptanceAdjustedF1(0.5, 75, 100), 0.375);
  assert.equal(acceptanceAdjustedF1(null, 75, 100), null);
});

test("should micro-average complete-oracle counts", () => {
  const cases = [
    { v2: { tp: 2, fp: 1, fn: 3 } },
    { v2: { tp: 4, fp: 2, fn: 0 } },
    { partialOracle: true, v2: { tp: 99, fp: null, fn: 1 } },
    { oracleAvailable: false, v2: { tp: 0, fp: 99, fn: 0 } },
  ];
  assert.equal(microF1(cases, (entry) => entry.v2), 12 / 18);
  assert.equal(microF1([], (entry) => entry.v2), null);
});

test("should summarize blind usefulness without exposing aliases as model names", () => {
  const mapping = [{ alias: "a", arm: "gpt41" }, { alias: "b", arm: "gpt41" }];
  const summary = summarizeJudgeVerdicts(mapping, {
    terra: [{ alias: "a", verdict: { usefulness: 3 } },
      { alias: "b", verdict: { usefulness: 5 } }],
    opus46: [{ alias: "a", verdict: { usefulness: 4 } },
      { alias: "b", verdict: { usefulness: 5 } }],
  });
  assert.deepEqual(summary.gpt41, { terra: { completed: 2, meanUsefulness: 4 },
    opus46: { completed: 2, meanUsefulness: 4.5 },
    agreement: { pairs: 2, exact: 1, meanAbsoluteDifference: 0.5 } });
});

test("should disclose that the Codex ChatGPT transport cannot enforce the output cap", () => {
  assert.deepEqual(receiptCap(arms["luna-low"], { outputTokens: 32_768 }), {
    requested: 32_768,
    enforced: false,
    reason: "Codex ChatGPT rejects max_output_tokens; the runner omits it.",
    observedOutputTokens: 32_768,
    classification: "within-observed-cap",
  });
  assert.equal(Object.values(arms).filter(({ lane }) => lane === "codex")
    .every(({ capEnforced }) => capEnforced === false), true);
  assert.deepEqual(codexCapOption(arms["sol-low"]), {});
});

test("should retry only transport classes and suspend a 429", () => {
  assert.equal(classifyFailure({ httpStatus: 500 }).retry, true);
  assert.equal(classifyFailure({ httpStatus: 425 }).retry, true);
  assert.equal(classifyFailure({ code: "ENOTFOUND" }).retry, true);
  assert.equal(classifyFailure({ code: "network_error" }).retry, true);
  assert.equal(classifyFailure({ terminalSse: { expected: true, terminal: false } }).retry, true);
  assert.deepEqual(classifyFailure({ httpStatus: 429 }),
    { category: "rate-limit", retry: false, suspend: true });
  assert.equal(classifyFailure({ code: "REQUEST_BUDGET_SUSPENDED" }).suspend, true);
  assert.equal(classifyFailure({ httpStatus: 400 }).retry, false);
  assert.equal(classifyFailure({ httpStatus: 200 }).retry, false);
});

test("should open an arm circuit after three consecutive failures with the same code", () => {
  let circuit = advanceCircuit(undefined, "HTTP_400", 3);
  circuit = advanceCircuit(circuit, "HTTP_400", 3);
  assert.equal(circuit.open, false);
  circuit = advanceCircuit(circuit, "HTTP_400", 3);
  assert.deepEqual(circuit, { code: "HTTP_400", consecutive: 3, open: true });
  assert.deepEqual(advanceCircuit(circuit, null, 3), circuit);
  assert.deepEqual(advanceCircuit(circuit, "HTTP_422", 3), circuit);
  assert.deepEqual(advanceCircuit({ code: "HTTP_400", consecutive: 2, open: false },
    "HTTP_422", 3), { code: "HTTP_422", consecutive: 1, open: false });
});

test("should gate Codex replay on transport rather than extraction acceptance", () => {
  const valid = { requestCount: 1, httpStatus: 200, jsonValid: true, accepted: true };
  const qualityRefusal = { requestCount: 1, httpStatus: 200, jsonValid: true, accepted: false };
  const isolatedTerminal = { requestCount: 1, httpStatus: 200, jsonValid: false, accepted: false };
  assert.equal(replayTransportGatePassed([valid, qualityRefusal, isolatedTerminal], 3), true);
  assert.equal(replayTransportGatePassed([valid, qualityRefusal,
    { requestCount: 1, httpStatus: 400, jsonValid: false, accepted: false }], 3), false);
});

test("should stop a provider queue after two consecutive arm circuits", () => {
  let queue = advanceCircuit(undefined, "arm-circuit-open", 2);
  assert.equal(queue.open, false);
  queue = advanceCircuit(queue, "arm-circuit-open", 2);
  assert.equal(queue.open, true);
  assert.equal(laneCircuitAction("codex", queue), "stop-lane");
  assert.equal(laneCircuitAction("cloud", queue), "continue");
  assert.equal(laneCircuitAction("anthropic", queue), "continue");
  assert.equal(advanceCircuit({ code: "arm-circuit-open", consecutive: 1, open: false },
    null, 2).consecutive, 0);
});

test("should parse provider reset headers without inventing an absent reset", () => {
  assert.equal(retryAt({ "retry-after": "2" }, 0), "1970-01-01T00:00:02.000Z");
  assert.equal(retryAt({ "x-ratelimit-reset-requests": "1500ms" }, 0),
    "1970-01-01T00:00:01.500Z");
  assert.equal(retryAt({}, 0), null);
});

test("should bound missing-reset 429 waits and yield after three consecutive suspensions", () => {
  const first = rateLimitPlan({}, 0, 0);
  const second = rateLimitPlan({}, first.consecutive, 0);
  const third = rateLimitPlan({}, second.consecutive, 0);
  assert.deepEqual(first, { consecutive: 1, resetAt: null,
    resumeAt: "1970-01-01T00:05:00.000Z", waitMs: 300_000, yieldLane: false });
  assert.equal(second.waitMs, 900_000);
  assert.equal(second.yieldLane, false);
  assert.equal(third.waitMs, 0);
  assert.equal(third.yieldLane, true);
  assert.equal(third.resumeAt, "1970-01-01T00:15:00.000Z");
});

test("should honor retry-after within the bounded suspension window", () => {
  assert.deepEqual(rateLimitPlan({ "retry-after": "30" }, 0, 0), {
    consecutive: 1,
    resetAt: "1970-01-01T00:00:30.000Z",
    resumeAt: "1970-01-01T00:00:30.250Z",
    waitMs: 30_250,
    yieldLane: false,
  });
  assert.equal(rateLimitPlan({ "retry-after": "3600" }, 0, 0).waitMs, 900_000);
});

test("should restart the 429 sequence after a successful request", () => {
  const suspended = rateLimitPlan({}, 1, 0);
  assert.equal(suspended.consecutive, 2);
  const recovered = resetRateLimitState();
  assert.deepEqual(recovered, { consecutive: 0, resumeAt: null });
  assert.equal(rateLimitPlan({}, recovered.consecutive, 0).waitMs, 300_000);
});

test("should release only a known rate-limit intent without a receipt", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "v101-resume-"));
  try {
    const paths = artifactPaths(root, "doc-a", "sonnet46-cloud-low", 1);
    await writeIntent(paths, { state: "in-flight", documentId: "doc-a",
      arm: "sonnet46-cloud-low" });
    assert.equal(await releaseRateLimitIntent(root, "doc-a", "sonnet46-cloud-low"), true);
    assert.equal((await resumeDecision(root, "doc-a", "sonnet46-cloud-low")).action, "run");
  } finally { await rm(root, { recursive: true, force: true }); }
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

test("should reserve attempts three and four for enabled terminal network replay", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "v101-network-replay-"));
  const previous = process.env.BENCHMARK_RETRY_NETWORK_TERMINAL;
  process.env.BENCHMARK_RETRY_NETWORK_TERMINAL = "1";
  try {
    assert.deepEqual(receiptAttemptOrder(), [4, 3, 2, 1]);
    assert.match(artifactPaths(root, "doc-a", "sonnet5-off", 3).stem, /attempt-3$/u);
    assert.match(artifactPaths(root, "doc-a", "sonnet5-off", 4).stem, /attempt-4$/u);
    await writeImmutable(artifactPaths(root, "doc-a", "sonnet5-off", 2).receipt,
      { status: "failed", error: { category: "network" }, retry: { eligible: false } });
    assert.equal((await resumeDecision(root, "doc-a", "sonnet5-off")).attempt, 3);
    await writeImmutable(artifactPaths(root, "doc-a", "sonnet5-off", 3).receipt,
      { status: "failed", error: { category: "terminal",
        code: "ERR_TLS_CERT_ALTNAME_INVALID" }, retry: { eligible: false } });
    assert.equal((await resumeDecision(root, "doc-a", "sonnet5-off")).attempt, 4);
    await writeImmutable(artifactPaths(root, "doc-a", "sonnet5-off", 4).receipt,
      { status: "failed", error: { category: "network" }, retry: { eligible: true } });
    assert.deepEqual(await resumeDecision(root, "doc-a", "sonnet5-off"), {
      action: "skip", attempt: 4,
      receipt: JSON.parse(await readFile(artifactPaths(root, "doc-a", "sonnet5-off", 4)
        .receipt, "utf8")),
      paths: artifactPaths(root, "doc-a", "sonnet5-off", 4),
    });
  } finally {
    if (previous === undefined) delete process.env.BENCHMARK_RETRY_NETWORK_TERMINAL;
    else process.env.BENCHMARK_RETRY_NETWORK_TERMINAL = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("should skip accepted and quality-refused receipts during terminal network replay", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "v101-network-skip-"));
  const previous = process.env.BENCHMARK_RETRY_NETWORK_TERMINAL;
  process.env.BENCHMARK_RETRY_NETWORK_TERMINAL = "1";
  try {
    await writeImmutable(artifactPaths(root, "accepted", "sonnet5-low", 2).receipt,
      { status: "completed", validation: { accepted: true }, retry: { eligible: false } });
    await writeImmutable(artifactPaths(root, "quality", "sonnet5-low", 2).receipt,
      { status: "completed", validation: { accepted: false }, retry: { eligible: false } });
    assert.equal((await resumeDecision(root, "accepted", "sonnet5-low")).action, "skip");
    assert.equal((await resumeDecision(root, "quality", "sonnet5-low")).action, "skip");
  } finally {
    if (previous === undefined) delete process.env.BENCHMARK_RETRY_NETWORK_TERMINAL;
    else process.env.BENCHMARK_RETRY_NETWORK_TERMINAL = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("should keep attempt two terminal when network replay is not enabled", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "v101-network-disabled-"));
  const previous = process.env.BENCHMARK_RETRY_NETWORK_TERMINAL;
  delete process.env.BENCHMARK_RETRY_NETWORK_TERMINAL;
  try {
    assert.deepEqual(receiptAttemptOrder(), [2, 1]);
    await writeImmutable(artifactPaths(root, "doc-a", "opus5-high", 2).receipt,
      { status: "failed", error: { category: "network" }, retry: { eligible: true } });
    const decision = await resumeDecision(root, "doc-a", "opus5-high");
    assert.equal(decision.action, "skip");
    assert.equal(decision.attempt, 2);
  } finally {
    if (previous === undefined) delete process.env.BENCHMARK_RETRY_NETWORK_TERMINAL;
    else process.env.BENCHMARK_RETRY_NETWORK_TERMINAL = previous;
    await rm(root, { recursive: true, force: true });
  }
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
