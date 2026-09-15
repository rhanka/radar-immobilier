import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const required = (name) => process.env[name]
  || (() => { throw new Error(`${name} is required`); })();
const repositoryRoot = required("BENCHMARK_REPOSITORY_ROOT");
const resultRoot = required("BENCHMARK_RESULT_ROOT");
const v100Root = resolve(repositoryRoot, "docs/reviews/refresh-benchmark/v100");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
async function frozenJson(path) {
  const bytes = await readFile(path);
  return { value: JSON.parse(bytes), sha256: sha256(bytes) };
}

const source = await frozenJson(resolve(v100Root, "manifest.json"));
const prompt = await frozenJson(resolve(v100Root, "prompt-freeze.json"));
const aggregate = await frozenJson(resolve(v100Root, "aggregate.json"));
const catalogs = await frozenJson(resolve(resultRoot, "availability/catalogs.json"));
const cPrime = await frozenJson(resolve(resultRoot, "cprime-baseline.json"));
if (source.value.documents.length !== 100 || prompt.value.documents.length !== 100
  || aggregate.value.corpus.documents !== 100) throw new Error("v100 is not the 100-document freeze");
const promptIds = new Set(prompt.value.documents.map(({ id }) => id));
for (const document of source.value.documents) {
  if (!promptIds.has(document.id)) throw new Error(`Missing prompt freeze: ${document.id}`);
  const text = await readFile(resolve(repositoryRoot, document.runtimeTextRelativePath));
  const pdf = await readFile(resolve(source.value.sourceRunRoot, "workers", document.city,
    "corpus", `${document.sha256}.pdf`));
  if (sha256(text) !== document.textSha256 || sha256(pdf) !== document.sha256) {
    throw new Error(`Corpus fingerprint mismatch: ${document.id}`);
  }
}

const manifest = {
  schemaVersion: 1,
  campaign: "v101",
  frozenAt: new Date().toISOString(),
  corpus: {
    sourceCampaign: "v100",
    documentCount: 100,
    cityCount: new Set(source.value.documents.map(({ city }) => city)).size,
    wording: "documents municipaux; certains éléments sont des ordres du jour",
    sourceRun: source.value.sourceRun,
    sourceRunRoot: source.value.sourceRunRoot,
    selection: source.value.selection,
  },
  contract: {
    version: "immo-pv-extraction-v9",
    mainMergeCommit: "4e3a4db8f71fe4824bf9aa9f166d1d47b95211c4",
    implementationCommit: prompt.value.t1Commit,
    implementationToMergeModuleDiff: "empty-measured",
    profileModuleSha256: prompt.value.profileModuleSha256,
    corpusModuleSha256: prompt.value.corpusModuleSha256,
    graphifyVersion: prompt.value.graphifyVersion,
    llmMeshVersion: "0.19.2",
  },
  outputCap: {
    commonMaxOutputTokens: 32768,
    historicalV100MaxOutputTokens: prompt.value.maxOutputTokens,
    state: "frozen-intent-wire-preflight-required",
    constraint: "gpt-4.1 documented maximum output",
    comparabilityNote: "v100 is historical context, not an exact cap replay",
    codexWireMaterialization: "not-observed-at-64-token-ping",
  },
  baselines: {
    strict: cPrime.value.strict,
    cPrime: cPrime.value.cPrime,
    cPrimePolicy: cPrime.value.policy,
  },
  fingerprints: {
    v100ManifestSha256: source.sha256,
    v100PromptFreezeSha256: prompt.sha256,
    v100AggregateSha256: aggregate.sha256,
    availabilityCatalogsSha256: catalogs.sha256,
    cPrimeBaselineSha256: cPrime.sha256,
  },
  parser: source.value.parser,
  documents: source.value.documents,
  promptFreeze: {
    systemPrompt: prompt.value.systemPrompt,
    systemPromptSha256: prompt.value.systemPromptSha256,
    documents: prompt.value.documents,
  },
};
await writeFile(resolve(resultRoot, "manifest.json"), `${JSON.stringify(manifest)}\n`,
  { flag: "wx" });
console.log(JSON.stringify({ campaign: manifest.campaign, documents: manifest.documents.length,
  cities: manifest.corpus.cityCount, commonMaxOutputTokens: manifest.outputCap.commonMaxOutputTokens,
  state: manifest.outputCap.state }));
