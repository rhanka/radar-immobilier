import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createGraphifyMesh } from "/workspace/node_modules/@sentropic/graphify/dist/llm-mesh.js";
import { CodexRuntimeClient, OpenAIAdapter } from "/workspace/node_modules/@sentropic/llm-mesh-refresh/dist/index.js";
import { createLlmMeshFacade } from "/workspace/node_modules/@sentropic/llm-mesh-refresh/dist/service/facade.js";
import { EncryptedFileKeyring } from "/workspace/node_modules/@sentropic/llm-mesh-refresh/dist/node/index.js";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const variants = {
  "luna-normal": { model: "gpt-5.6-luna", effort: "medium" },
  "luna-high": { model: "gpt-5.6-luna", effort: "high" },
  "sol-normal": { model: "gpt-5.6-sol", effort: "medium" },
  "sol-high": { model: "gpt-5.6-sol", effort: "high" },
};
const required = (name) => process.env[name] || (() => { throw new Error(`${name} is required`); })();
const caseDocument = required("BENCHMARK_DOCUMENT");
const variantName = required("BENCHMARK_VARIANT");
const attemptNumber = Number(process.env.BENCHMARK_ATTEMPT ?? "1");
const retryReason = process.env.BENCHMARK_RETRY_REASON ?? null;
if (!Number.isInteger(attemptNumber) || attemptNumber < 1 || attemptNumber > 2) {
  throw new Error("BENCHMARK_ATTEMPT must be 1 or 2");
}
if (attemptNumber === 2 && !retryReason) throw new Error("Attempt 2 requires BENCHMARK_RETRY_REASON");
const variant = variants[variantName];
if (!variant) throw new Error(`Unsupported live variant: ${variantName}`);
const repositoryRoot = required("BENCHMARK_REPOSITORY_ROOT");
const campaign = process.env.BENCHMARK_CAMPAIGN;
const t1Root = required("BENCHMARK_T1_ROOT");
const t1Commit = required("BENCHMARK_T1_COMMIT");
const ownerScopeRef = required("BENCHMARK_OWNER_SCOPE");
const outputDir = required("BENCHMARK_OUTPUT_DIR");
const manifest = JSON.parse(await readFile(resolve(repositoryRoot,
  `docs/reviews/refresh-benchmark/${campaign ? `${campaign}/` : ""}manifest.json`), "utf8"));
const frozen = JSON.parse(await readFile(resolve(repositoryRoot,
  `docs/reviews/refresh-benchmark/${campaign ? `${campaign}/` : ""}prompt-freeze.json`), "utf8"));
const document = manifest.documents.find(({ id }) => id === caseDocument);
if (!document) throw new Error(`Unknown frozen document: ${caseDocument}`);
if (frozen.t1Commit !== t1Commit) throw new Error("T1 prompt commit differs from frozen contract");
const expected = frozen.documents.find(({ id }) => id === document.id);
if (!expected) throw new Error("Document is absent from the frozen prompt contract");
const caseId = `${document.id}--${variantName}`;
const attemptSuffix = attemptNumber === 1 ? "" : `.attempt-${attemptNumber}`;
const receiptPath = resolve(outputDir, `${caseId}${attemptSuffix}.receipt.json`);
const outputPath = resolve(outputDir, `${caseId}${attemptSuffix}.output.json`);
await mkdir(outputDir, { recursive: true });
if (attemptNumber === 2) await access(resolve(outputDir, `${caseId}.receipt.json`));
for (const path of [receiptPath, outputPath]) await access(path).then(
  () => { throw new Error(`Refusing quality rerun over ${path}`); }, () => undefined);

const runRoot = resolve(repositoryRoot, manifest.sourceRunRoot);
const workerRoot = resolve(runRoot, "workers", document.city);
const pdfPath = resolve(workerRoot, "corpus", `${document.sha256}.pdf`);
const parsedPath = resolve(repositoryRoot, document.runtimeTextRelativePath);
const pdf = await readFile(pdfPath);
const parsedText = await readFile(parsedPath, "utf8");
if (sha256(pdf) !== document.sha256 || sha256(parsedText) !== document.textSha256) {
  throw new Error("Frozen input hash mismatch");
}
const profileModulePath = resolve(t1Root, "api/src/services/graph/refresh-profile.ts");
const corpusModulePath = resolve(t1Root, "api/src/services/graph/refresh-corpus.ts");
const profileModuleSha256 = sha256(await readFile(profileModulePath));
if (profileModuleSha256 !== frozen.profileModuleSha256) throw new Error("T1 profile module hash mismatch");
if (sha256(await readFile(corpusModulePath)) !== frozen.corpusModuleSha256) throw new Error("T1 corpus module hash mismatch");
const { extractRefreshProfile, loadRefreshProfileContext } = await import(pathToFileURL(profileModulePath));
const { materializeRefreshCorpus } = await import(pathToFileURL(corpusModulePath));
const originalKey = document.originalKey;
const manifestKey = "refresh-benchmark-input.tsv";
const tsv = `source_id\tcity_slug\tsha\trepresentation_key\tsidecar_key\n${document.sourceId}\t${document.city}\t${document.sha256}\t${originalKey}\t${originalKey}.meta.json\n`;
const reader = { async get(key) {
  if (key === manifestKey) return Buffer.from(tsv);
  if (key === originalKey) return pdf;
  if (key === `${originalKey}.meta.json`) return readFile(`${pdfPath}.meta.json`);
  throw new Error(`Unexpected input key: ${key}`);
} };
const corpus = await materializeRefreshCorpus({ citySlug: document.city, manifestKey, reader,
  extractPdf: async () => parsedText });
if (corpus.chunks.length !== 1) throw new Error("Pilot requires exactly one T1 chunk per document");
const context = loadRefreshProfileContext({ root: t1Root,
  profilePath: resolve(t1Root, "radar/ontology/ontology-profile.yaml"), unregisteredOnly: true });

const facade = createLlmMeshFacade({ mode: "cli",
  configResolver: { async resolveConfig() { return {}; } },
  keyring: new EncryptedFileKeyring("/run/benchmark-keyring") });
const accounts = (await facade.listAccounts({ ownerScope: ownerScopeRef }))
  .filter((account) => account.providerId === "codex");
if (accounts.length !== 1) throw new Error(`Expected one Codex enrollment, found ${accounts.length}`);
const accountPseudonym = `acct-${sha256(accounts[0].accountId).slice(0, 10)}`;
let wire;
let generated;
let generationStarted;
let inputHashes;
const observedFetch = async (url, init) => {
  const fetchStarted = Date.now();
  const bodyText = String(init?.body ?? "");
  const body = JSON.parse(bodyText);
  const signal = init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
  const response = await fetch(url, { ...init, signal });
  wire = { fetchStartedAt: new Date(fetchStarted).toISOString(), httpStatus: response.status,
    requestBodySha256: sha256(bodyText), model: body.model, reasoning: body.reasoning,
    maxOutputTokens: body.max_output_tokens, inputBytes: Buffer.byteLength(bodyText),
    requestId: response.headers.get("x-request-id") ?? response.headers.get("openai-request-id") };
  return response;
};
const mesh = createGraphifyMesh({
  routingSubject: { principalRef: "principal:refresh-benchmark", ownerScopeRef },
  adapters: { openai: new OpenAIAdapter({ client: new CodexRuntimeClient({ fetch: observedFetch }) }) },
  createRoutePlanner: (runtime) => facade.createRoutePlanner(runtime),
});
const textClient = { mode: "mesh", provider: "openai", model: variant.model,
  async generateJson(input) {
    generationStarted = Date.now();
    inputHashes = { schemaSha256: sha256(input.schema), promptSha256: sha256(input.prompt) };
    if (inputHashes.schemaSha256 !== expected.schemaSha256
      || inputHashes.promptSha256 !== expected.promptSha256) throw new Error("Prompt/schema hash mismatch");
    const request = { providerId: "openai", modelId: variant.model, reasoning: { effort: variant.effort },
      messages: [{ role: "system", content: frozen.systemPrompt }, { role: "user",
        content: `Schema: ${input.schema}\n\n${input.prompt}` }], responseFormat: { type: "json-object" },
      maxOutputTokens: input.maxOutputTokens, signal: controller.signal };
    generated = await mesh.generateValidated(request, async (response) => {
      generated = response;
      await input.validateResponse(response.text ?? "");
    });
    await writeFile(input.outputPath, generated.text ?? "", "utf8");
    return { status: "completed", provider: "openai", mode: "mesh", model: variant.model,
      outputPath: input.outputPath, audit: { mesh: true, providerId: "openai", modelId: variant.model } };
  } };
let status = "completed";
let error;
let extraction;
const started = Date.now();
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 480_000);
try {
  extraction = (await extractRefreshProfile(corpus.chunks, { textClient, context,
    maxOutputTokens: frozen.maxOutputTokens }))[0]?.extraction;
} catch (caught) {
  status = "failed";
  error = caught instanceof Error ? { name: caught.name, message: caught.message } : { message: String(caught) };
} finally { clearTimeout(timeout); }
const completed = Date.now();
if (generated?.text) await writeFile(outputPath, JSON.stringify(JSON.parse(generated.text)), "utf8");
const receipt = { schemaVersion: 1, campaign: campaign ?? "v1", caseId, status, t1Commit, profileModuleSha256,
  documentId: document.id, input: { pdfSha256: document.sha256, textSha256: document.textSha256 },
  requested: { providerId: "openai", modelId: variant.model, effort: variant.effort,
    maxOutputTokens: frozen.maxOutputTokens, transportTimeoutMs: 480_000 }, accountPseudonym, wire,
  actual: generated ? { responseId: generated.id, providerId: generated.providerId,
    modelId: generated.modelId, finishReason: generated.finishReason,
    responseTextSha256: sha256(generated.text ?? ""), usage: generated.usage } : null,
  hashes: inputHashes, timing: { startedAt: new Date(started).toISOString(),
    completedAt: new Date(completed).toISOString(), totalMs: completed - started,
    queueMs: wire && generationStarted ? Date.parse(wire.fetchStartedAt) - generationStarted : null,
    runMs: wire ? completed - Date.parse(wire.fetchStartedAt) : null }, attempts: 1,
  extractionAccepted: Boolean(extraction), attemptNumber, retryReason, error };
await writeFile(receiptPath, JSON.stringify(receipt), "utf8");
console.log(JSON.stringify(receipt));
if (status !== "completed") process.exitCode = 1;
