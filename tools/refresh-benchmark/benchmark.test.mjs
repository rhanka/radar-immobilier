import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = process.env.BENCHMARK_REPOSITORY_ROOT;
if (!root) throw new Error("BENCHMARK_REPOSITORY_ROOT is required");
const campaign = process.env.BENCHMARK_CAMPAIGN;
const campaignRoot = `docs/reviews/refresh-benchmark/${campaign ? `${campaign}/` : ""}`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const manifest = JSON.parse(await readFile(resolve(root,
  `${campaignRoot}manifest.json`), "utf8"));
const prompts = JSON.parse(await readFile(resolve(root,
  `${campaignRoot}prompt-freeze.json`), "utf8"));

test("the five immutable PDFs and page texts match the manifest", async () => {
  assert.equal(manifest.documents.length, 5);
  for (const document of manifest.documents) {
    const worker = resolve(manifest.sourceRunRoot, "workers", document.city);
    const pdf = await readFile(resolve(worker, "corpus", `${document.sha256}.pdf`));
    const text = await readFile(resolve(root, document.runtimeTextRelativePath), "utf8");
    const pages = text.split("\f").map((page) => page.replace(/\r\n/g, "\n"));
    if (pages.at(-1) === "") pages.pop();
    assert.equal(sha256(pdf), document.sha256);
    assert.equal(sha256(text), document.textSha256);
    assert.equal(pages.length, document.pageCount);
    assert.deepEqual(pages.map(sha256), document.pageTextSha256);
    assert.equal(document.sourceUrl.startsWith("https://"), true);
  }
});

test("prompt contract covers each input once and is tied to corrected T1", async () => {
  assert.equal(prompts.graphifyVersion, "0.18.0");
  assert.equal(prompts.meshVersion,
    ["v5", "v6", "v7", "v8", "v9", "v10", "v11", "v12", "v13", "v14", "v15", "v16"].includes(campaign)
      ? "0.19.1" : "0.19.0");
  assert.equal(prompts.t1Commit,
    process.env.BENCHMARK_T1_COMMIT ?? "f9b311da536bda2e1442d154a05599c35b482518");
  assert.equal(prompts.maxOutputTokens, ["v13", "v14", "v15", "v16"].includes(campaign) ? 64_000
    : ["v7", "v8", "v9", "v10", "v11", "v12"].includes(campaign) ? 65_536 : 16_384);
  assert.equal(sha256(prompts.systemPrompt), prompts.systemPromptSha256);
  assert.deepEqual(prompts.documents.map(({ id }) => id).sort(),
    manifest.documents.map(({ id }) => id).sort());
  for (const document of prompts.documents) {
    assert.match(document.schemaSha256, /^[0-9a-f]{64}$/);
    assert.match(document.promptSha256, /^[0-9a-f]{64}$/);
    assert.equal(document.pages.length,
      manifest.documents.find(({ id }) => id === document.id).pageCount);
  }
});

test("controls keep their regulatory meaning", () => {
  if (["v3", "v5", "v6", "v7", "v8", "v9", "v10", "v11", "v12", "v13", "v14", "v15", "v16"].includes(campaign)) {
    assert.equal(manifest.documents.some(({ selectionRationale }) =>
      /agenda/.test(selectionRationale) && /not adoption/.test(selectionRationale)), true);
    return;
  }
  const negative = manifest.documents.find(({ id }) => id.endsWith("negative"));
  const agenda = manifest.documents.find(({ id }) => id.startsWith("wickham"));
  assert.match(negative.selectionRationale, /Observed no-finding control/);
  assert.match(agenda.selectionRationale, /future agenda/);
  assert.match(agenda.selectionRationale, /no completed adoption/);
});

test("v11 keeps v10 frozen except for the v7 profile-derived prompt contract", async () => {
  if (campaign !== "v11") return;
  const v10Root = resolve(root, "docs/reviews/refresh-benchmark/v10");
  const v10Manifest = JSON.parse(await readFile(resolve(v10Root, "manifest.json"), "utf8"));
  const v10Prompts = JSON.parse(await readFile(resolve(v10Root, "prompt-freeze.json"), "utf8"));
  const { campaign: _v11Campaign, ...v11Manifest } = manifest;
  const { campaign: _v10Campaign, ...baseManifest } = v10Manifest;
  assert.deepEqual(v11Manifest, baseManifest);
  assert.deepEqual(await readFile(resolve(campaignRoot, "manual-oracle.json")),
    await readFile(resolve(v10Root, "manual-oracle.json")));
  const stablePrompt = ({ campaign: _campaign, frozenAt: _time, t1Commit: _commit,
    profileModuleSha256: _profile, corpusModuleSha256: _corpus, documents, ...stable }) => ({ ...stable,
    documents: documents.map(({ schemaSha256: _schema, promptSha256: _prompt,
      schemaBytes: _schemaBytes, promptBytes: _promptBytes, ...document }) => document) });
  assert.deepEqual(stablePrompt(prompts), stablePrompt(v10Prompts));
  assert.notEqual(prompts.t1Commit, v10Prompts.t1Commit);
  assert.notEqual(prompts.profileModuleSha256, v10Prompts.profileModuleSha256);
  assert.notEqual(prompts.corpusModuleSha256, v10Prompts.corpusModuleSha256);
  for (const document of prompts.documents) {
    const previous = v10Prompts.documents.find(({ id }) => id === document.id);
    assert.notEqual(document.schemaSha256, previous.schemaSha256);
    assert.notEqual(document.promptSha256, previous.promptSha256);
  }
});

test("v13 keeps the v9 corpus and oracle frozen, and moves only the profile and the cap", async () => {
  if (campaign !== "v13") return;
  const v9Root = resolve(root, "docs/reviews/refresh-benchmark/v9");
  const v9Manifest = JSON.parse(await readFile(resolve(v9Root, "manifest.json"), "utf8"));
  const v9Prompts = JSON.parse(await readFile(resolve(v9Root, "prompt-freeze.json"), "utf8"));
  const { campaign: _v13Campaign, ...v13Manifest } = manifest;
  const { campaign: _v9Campaign, ...baseManifest } = v9Manifest;
  assert.deepEqual(v13Manifest, baseManifest);
  assert.deepEqual(await readFile(resolve(root, `${campaignRoot}manual-oracle.json`)),
    await readFile(resolve(v9Root, "manual-oracle.json")));
  const stablePrompt = ({ campaign: _campaign, frozenAt: _time, t1Commit: _commit,
    profileModuleSha256: _profile, corpusModuleSha256: _corpus, maxOutputTokens: _cap,
    documents, ...stable }) => ({ ...stable,
    documents: documents.map(({ schemaSha256: _schema, promptSha256: _prompt,
      schemaBytes: _schemaBytes, promptBytes: _promptBytes, ...document }) => document) });
  assert.deepEqual(stablePrompt(prompts), stablePrompt(v9Prompts));
  // The contract moves from v5 to v8: the profile module, the prompt and the schema all change.
  assert.notEqual(prompts.t1Commit, v9Prompts.t1Commit);
  assert.notEqual(prompts.profileModuleSha256, v9Prompts.profileModuleSha256);
  for (const document of prompts.documents) {
    const previous = v9Prompts.documents.find(({ id }) => id === document.id);
    assert.notEqual(document.schemaSha256, previous.schemaSha256);
    assert.notEqual(document.promptSha256, previous.promptSha256);
  }
  // One cap for both arms, at the highest value Cloud Code accepts (v12 probes).
  assert.equal(prompts.maxOutputTokens, 64_000);
  assert.equal(v9Prompts.maxOutputTokens, 65_536);
});

test("v10 keeps v9 frozen except for the v6 profile-derived prompt contract", async () => {
  if (campaign !== "v10") return;
  const v9Root = resolve(root, "docs/reviews/refresh-benchmark/v9");
  const v9Manifest = JSON.parse(await readFile(resolve(v9Root, "manifest.json"), "utf8"));
  const v9Prompts = JSON.parse(await readFile(resolve(v9Root, "prompt-freeze.json"), "utf8"));
  const { campaign: _v10Campaign, ...v10Manifest } = manifest;
  const { campaign: _v9Campaign, ...baseManifest } = v9Manifest;
  assert.deepEqual(v10Manifest, baseManifest);
  assert.deepEqual(await readFile(resolve(campaignRoot, "manual-oracle.json")),
    await readFile(resolve(v9Root, "manual-oracle.json")));
  const stablePrompt = ({ campaign: _campaign, frozenAt: _time, t1Commit: _commit,
    profileModuleSha256: _profile, documents, ...stable }) => ({ ...stable,
    documents: documents.map(({ schemaSha256: _schema, promptSha256: _prompt,
      schemaBytes: _schemaBytes, promptBytes: _promptBytes, ...document }) => document) });
  assert.deepEqual(stablePrompt(prompts), stablePrompt(v9Prompts));
  assert.notEqual(prompts.t1Commit, v9Prompts.t1Commit);
  assert.notEqual(prompts.profileModuleSha256, v9Prompts.profileModuleSha256);
  for (const document of prompts.documents) {
    const previous = v9Prompts.documents.find(({ id }) => id === document.id);
    assert.notEqual(document.schemaSha256, previous.schemaSha256);
    assert.notEqual(document.promptSha256, previous.promptSha256);
  }
});

test("later campaigns keep the v7 corpus and prompt contract equivalent apart from metadata", async () => {
  if (!["v8", "v9", "v12"].includes(campaign)) return;
  const v7Root = resolve(root, "docs/reviews/refresh-benchmark/v7");
  const v7Manifest = JSON.parse(await readFile(resolve(v7Root, "manifest.json"), "utf8"));
  const v7Prompts = JSON.parse(await readFile(resolve(v7Root, "prompt-freeze.json"), "utf8"));
  const { campaign: _v8ManifestCampaign, frozenAt: _v8ManifestTime, ...v8Manifest } = manifest;
  const { campaign: _v7ManifestCampaign, frozenAt: _v7ManifestTime, ...baseManifest } = v7Manifest;
  const { campaign: _v8PromptCampaign, frozenAt: _v8PromptTime, ...v8Prompts } = prompts;
  const { campaign: _v7PromptCampaign, frozenAt: _v7PromptTime, ...basePrompts } = v7Prompts;
  assert.deepEqual(v8Manifest, baseManifest);
  assert.deepEqual(v8Prompts, basePrompts);
  assert.deepEqual(await readFile(resolve(campaignRoot, "manual-oracle.json")),
    await readFile(resolve(v7Root, "manual-oracle.json")));
});

test("the live runner binds the wall timeout to the actual fetch", async () => {
  const runner = await readFile(resolve(root, "tools/refresh-benchmark/run-case.mjs"), "utf8");
  assert.match(runner, /AbortSignal\.any\(\[init\.signal, controller\.signal\]\)/);
  assert.match(runner, /fetch\(url, \{ \.\.\.init, signal \}\)/);
  assert.match(runner,
    /setTimeout\(\(\) => controller\.abort\(\), executionContract\.transportTimeoutMs\)/);
  assert.equal(runner.indexOf("await writeFile(rawPath, responseText, \"utf8\")")
    < runner.indexOf("await input.validateResponse(responseText)"), true);
  for (const field of ["jsonValidRaw", "wrapperNormalized", "jsonValidAfterNormalize",
    "extractionValid", "profileValid", "profileViolations", "provenanceValid",
    "preExpansionProfileValid", "nativeParseError"]) assert.match(runner, new RegExp(field));
});
