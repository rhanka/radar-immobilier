import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = process.env.BENCHMARK_REPOSITORY_ROOT;
if (!root) throw new Error("BENCHMARK_REPOSITORY_ROOT is required");
const evidenceRoot = resolve(root, "docs/reviews/refresh-benchmark/v4");
const loadJson = async (name) => JSON.parse(await readFile(resolve(evidenceRoot, name), "utf8"));

test("Gemini evidence isolates the llm-mesh endpoint defect from effort and quota", async () => {
  const daily = await loadJson("gemini-debug-01-mesh-low.json");
  const standard = await loadJson("gemini-debug-02-agy-host-low.json");

  assert.equal(daily.wire.effectiveEndpoint.includes("daily-cloudcode-pa"), true);
  assert.equal(daily.wire.httpStatus, 404);
  assert.equal(standard.wire.effectiveEndpoint.includes("daily-cloudcode-pa"), false);
  assert.equal(standard.wire.httpStatus, 429);
  assert.equal(daily.wire.model, standard.wire.model);
  assert.equal(daily.wire.providerEffort, "LOW");
  assert.equal(standard.wire.providerEffort, "LOW");
  assert.equal(daily.wire.maxOutputTokens, standard.wire.maxOutputTokens);
});

test("benchmark handoff does not require an external gateway", async () => {
  const paths = [
    "docs/reviews/refresh-benchmark/v4/gemini-transport-diagnosis.md",
    "docs/reviews/refresh-benchmark/v4/protocol.md",
    "docs/reviews/refresh-benchmark/v4/report.md",
    "plan/T1BENCH-BRANCH_feat-t1-model-benchmark-real.md",
  ];
  const text = (await Promise.all(paths.map((path) => readFile(resolve(root, path), "utf8")))).join("\n");

  assert.doesNotMatch(text, /(?:official|operational|existing) gateway|gateway integration pending/i);
  assert.match(text, /No external gateway/);
  assert.match(text, /llm-mesh endpoint correction/);
});
