import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { adapterBindings, executionContract, frozenInputs, outputTokenCapForCampaign,
  releaseAnchor } from
  "./integration-contract.mjs";
import { variants } from "./runtime-config.mjs";

const root = process.env.BENCHMARK_REPOSITORY_ROOT;
if (!root) throw new Error("BENCHMARK_REPOSITORY_ROOT is required");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("the llm-mesh release anchor identifies the published package", () => {
  assert.deepEqual(releaseAnchor, {
    packageName: "@sentropic/llm-mesh",
    version: "0.19.1",
    publicationEvidence: "npm registry shasum 4ea47d90242c58dee638c25e1626b7c6265be511",
  });
});

test("the five PDFs and prompt-schema contract remain frozen", async () => {
  const manifestBytes = await readFile(resolve(root, frozenInputs.manifest.path));
  const promptBytes = await readFile(resolve(root, frozenInputs.prompts.path));
  assert.equal(sha256(manifestBytes), frozenInputs.manifest.sha256);
  assert.equal(sha256(promptBytes), frozenInputs.prompts.sha256);

  const manifest = JSON.parse(manifestBytes);
  const prompts = JSON.parse(promptBytes);
  assert.deepEqual(manifest.documents.map(({ id, sha256: digest }) => [id, digest]),
    frozenInputs.documents);
  assert.deepEqual(prompts.documents.map(({ id }) => id),
    frozenInputs.documents.map(([id]) => id));
  assert.equal(prompts.systemPromptSha256, executionContract.systemPromptSha256);
  assert.equal(prompts.maxOutputTokens, executionContract.maxOutputTokens);
  assert.equal(prompts.graphifyVersion, executionContract.graphify.version);
});

test("all live variants use the frozen adapter boundary and execution budget", () => {
  assert.deepEqual(adapterBindings, {
    gemini: { adapter: "GeminiAdapter", client: "CloudCodeRuntimeClient" },
    openai: { adapter: "OpenAIAdapter", client: "CodexRuntimeClient" },
  });
  assert.deepEqual([...new Set(Object.values(variants).map(({ provider }) => provider))].sort(),
    Object.keys(adapterBindings).sort());
  assert.deepEqual(executionContract, {
    graphify: { packageName: "@sentropic/graphify", version: "0.18.0" },
    graphifyFactory: "createGraphifyMesh",
    systemPromptSha256: "bdc1327904ac4c5a36b91dfdbe887a6f1a900b8fe5f1427249e54d83c250d461",
    maxOutputTokens: 16_384,
    transportTimeoutMs: 480_000,
    maxAttempts: 2,
    retryOnlyAfter: "transport_failure",
  });
  assert.equal(outputTokenCapForCampaign("v6"), 16_384);
  assert.equal(outputTokenCapForCampaign("v7"), 65_536);
  assert.equal(outputTokenCapForCampaign("v8"), 65_536);
  assert.equal(outputTokenCapForCampaign("v9"), 65_536);
  assert.equal(outputTokenCapForCampaign("v10"), 65_536);
});
