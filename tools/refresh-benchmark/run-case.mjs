import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createGraphifyMesh } from "/workspace/node_modules/@sentropic/graphify/dist/llm-mesh.js";
import { validateExtraction, validateProfileExtraction } from
  "/workspace/node_modules/@sentropic/graphify/dist/index.js";
import { CloudCodeRuntimeClient, CodexRuntimeClient, GeminiAdapter, getModelProfile,
  OpenAIAdapter } from "/workspace/node_modules/@sentropic/llm-mesh/dist/index.js";
import { createLlmMeshFacade } from "/workspace/node_modules/@sentropic/llm-mesh/dist/service/facade.js";
import { EncryptedFileKeyring } from "/workspace/node_modules/@sentropic/llm-mesh/dist/node/index.js";
import { executionContract } from "./integration-contract.mjs";
import { createPinnedWirePlanner } from "./pinned-wire-planner.mjs";
import { createAdapterSet, inspectWireBody, selectAccount, validateRetry, variants } from
  "./runtime-config.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const required = (name) => process.env[name] || (() => { throw new Error(`${name} is required`); })();
function parseErrorDetails(error, source) {
  if (!(error instanceof SyntaxError)) return null;
  const match = error.message.match(/(?:at )?position\s+(\d+)/iu);
  const leadingWhitespace = source.length - source.trimStart().length;
  const position = match ? Number(match[1])
    : source.trimStart().startsWith("```") && error.message.includes("Unexpected token '`'")
      ? leadingWhitespace : null;
  return { name: error.name, message: error.message, position };
}
function errorDetails(error) {
  if (!(error instanceof Error)) return { message: String(error) };
  return { name: error.name, message: error.message,
    ...(error.cause instanceof Error ? { cause: errorDetails(error.cause) } : {}) };
}
function strictJsonCandidate(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return { text: fenced ? fenced[1].trim() : trimmed, wrapperNormalized: Boolean(fenced) };
}
function pageTexts(chunk) {
  const markers = [...chunk.text.matchAll(/^\[PDF PAGE ([1-9]\d*)\]\n/gm)];
  return new Map(markers.map((marker, index) => {
    const start = marker.index + marker[0].length;
    return [Number(marker[1]), chunk.text.slice(start, markers[index + 1]?.index ?? chunk.text.length)];
  }));
}
function provenanceViolations(extraction, chunk, containsNormalizedPdfExcerpt) {
  const violations = [];
  const texts = pageTexts(chunk);
  const validateRecord = (record, path) => {
    if (record.source_file !== chunk.originalKey || record.rawRef !== chunk.originalKey
      || record.docSha !== chunk.docSha || record.sourceUrl !== chunk.sourceUrl
      || record.modality !== "pdf") violations.push({ path, code: "invalid_pdf_identity" });
    if (!Number.isInteger(record.page) || !chunk.pages.includes(record.page)) {
      violations.push({ path, code: "invalid_pdf_page" });
    } else if (typeof record.excerpt !== "string"
      || !containsNormalizedPdfExcerpt(texts.get(record.page) ?? "", record.excerpt)) {
      violations.push({ path, code: "ungrounded_pdf_excerpt" });
    }
  };
  extraction.nodes.forEach((node, index) => {
    if (!node.node_type) violations.push({ path: `nodes[${index}]`, code: "untyped_node" });
  });
  [...extraction.nodes, ...extraction.edges, ...(extraction.hyperedges ?? [])].forEach((entity, index) => {
    if (entity.source_file !== chunk.originalKey) {
      violations.push({ path: `entities[${index}]`, code: "invalid_entity_source_file" });
    }
  });
  [...extraction.nodes, ...extraction.edges].forEach((entity, entityIndex) =>
    (entity.citations ?? []).forEach((citation, citationIndex) =>
      validateRecord(citation, `entities[${entityIndex}].citations[${citationIndex}]`)));
  (extraction.evidence ?? []).forEach((evidence, index) => validateRecord(evidence, `evidence[${index}]`));
  return violations;
}
function inspectResponse(text, context, chunk, containsNormalizedPdfExcerpt) {
  let rawParseError = null;
  try { JSON.parse(text); } catch (error) { rawParseError = parseErrorDetails(error, text); }
  const normalized = strictJsonCandidate(text);
  let parsed;
  let normalizedParseError = null;
  try { parsed = JSON.parse(normalized.text); } catch (error) {
    normalizedParseError = parseErrorDetails(error, normalized.text);
  }
  const validation = { jsonValidRaw: rawParseError === null,
    wrapperNormalized: normalized.wrapperNormalized,
    jsonValidAfterNormalize: normalizedParseError === null,
    extractionValid: null, extractionViolations: [], profileValid: null,
    profileViolations: [], provenanceValid: null, provenanceViolations: [],
    nativeParseError: normalizedParseError ?? rawParseError,
    parseErrors: { raw: rawParseError, afterNormalize: normalizedParseError } };
  if (normalizedParseError) return { validation, parsed: undefined };
  validation.extractionViolations = validateExtraction(parsed);
  validation.extractionValid = validation.extractionViolations.length === 0;
  if (!validation.extractionValid) return { validation, parsed };
  const profile = validateProfileExtraction(parsed, { profile: context.profile,
    registryExtraction: context.registryExtraction });
  validation.profileValid = profile.valid;
  validation.profileViolations = profile.issues;
  if (!profile.valid) return { validation, parsed };
  validation.provenanceViolations = provenanceViolations(parsed, chunk, containsNormalizedPdfExcerpt);
  validation.provenanceValid = validation.provenanceViolations.length === 0;
  return { validation, parsed };
}
const caseDocument = required("BENCHMARK_DOCUMENT");
const variantName = required("BENCHMARK_VARIANT");
const attemptNumber = Number(process.env.BENCHMARK_ATTEMPT ?? "1");
const retryReason = process.env.BENCHMARK_RETRY_REASON ?? null;
if (!Number.isInteger(attemptNumber) || attemptNumber < 1
  || attemptNumber > executionContract.maxAttempts) {
  throw new Error(`BENCHMARK_ATTEMPT must be 1 or ${executionContract.maxAttempts}`);
}
const variant = variants[variantName];
if (!variant) throw new Error(`Unsupported live variant: ${variantName}`);
const repositoryRoot = required("BENCHMARK_REPOSITORY_ROOT");
const campaign = process.env.BENCHMARK_CAMPAIGN;
const fixtureCampaign = campaign === "v4" ? "v3" : campaign;
const t1Root = required("BENCHMARK_T1_ROOT");
const t1Commit = required("BENCHMARK_T1_COMMIT");
const ownerScopeRef = required("BENCHMARK_OWNER_SCOPE");
const outputDir = required("BENCHMARK_OUTPUT_DIR");
const manifest = JSON.parse(await readFile(resolve(repositoryRoot,
  `docs/reviews/refresh-benchmark/${fixtureCampaign ? `${fixtureCampaign}/` : ""}manifest.json`), "utf8"));
const frozen = JSON.parse(await readFile(resolve(repositoryRoot,
  `docs/reviews/refresh-benchmark/${fixtureCampaign ? `${fixtureCampaign}/` : ""}prompt-freeze.json`), "utf8"));
if (frozen.graphifyVersion !== executionContract.graphify.version
  || frozen.systemPromptSha256 !== executionContract.systemPromptSha256
  || frozen.maxOutputTokens !== executionContract.maxOutputTokens) {
  throw new Error("Frozen Graphify prompt contract differs from the integration contract");
}
const document = manifest.documents.find(({ id }) => id === caseDocument);
if (!document) throw new Error(`Unknown frozen document: ${caseDocument}`);
if (frozen.t1Commit !== t1Commit) throw new Error("T1 prompt commit differs from frozen contract");
const expected = frozen.documents.find(({ id }) => id === document.id);
if (!expected) throw new Error("Document is absent from the frozen prompt contract");
const caseId = `${document.id}--${variantName}`;
const attemptSuffix = attemptNumber === 1 ? "" : `.attempt-${attemptNumber}`;
const receiptPath = resolve(outputDir, `${caseId}${attemptSuffix}.receipt.json`);
const outputPath = resolve(outputDir, `${caseId}${attemptSuffix}.output.json`);
const rawPath = resolve(outputDir, `${caseId}${attemptSuffix}.raw.txt`);
await mkdir(outputDir, { recursive: true });
let previousReceipt = null;
if (attemptNumber === executionContract.maxAttempts) {
  previousReceipt = JSON.parse(await readFile(resolve(outputDir, `${caseId}.receipt.json`), "utf8"));
}
validateRetry({ attemptNumber, retryReason, previousReceipt });
for (const path of [receiptPath, outputPath, rawPath]) await access(path).then(
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
const { containsNormalizedPdfExcerpt, materializeRefreshCorpus } = await import(pathToFileURL(corpusModulePath));
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
const account = selectAccount(await facade.listAccounts({ ownerScope: ownerScopeRef }), variant);
const accountPseudonym = `acct-${sha256(account.accountId).slice(0, 10)}`;
let wire;
let generated;
let generationStarted;
let inputHashes;
let normalizedResponse;
let responseValidation = { jsonValidRaw: null, wrapperNormalized: null,
  jsonValidAfterNormalize: null, extractionValid: null, extractionViolations: [],
  profileValid: null, profileViolations: [], provenanceValid: null,
  provenanceViolations: [], nativeParseError: null,
  parseErrors: { raw: null, afterNormalize: null } };
const routeOutcomes = [];
const observedFetch = async (url, init) => {
  const fetchStarted = Date.now();
  const bodyText = String(init?.body ?? "");
  const body = JSON.parse(bodyText);
  const observed = inspectWireBody(variant, body, frozen.maxOutputTokens);
  const signal = init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
  const response = await fetch(url, { ...init, signal });
  wire = { fetchStartedAt: new Date(fetchStarted).toISOString(), httpStatus: response.status,
    requestBodySha256: sha256(bodyText), ...observed, inputBytes: Buffer.byteLength(bodyText),
    requestId: response.headers.get("x-request-id") ?? response.headers.get("openai-request-id") };
  return response;
};
const mesh = createGraphifyMesh({
  routingSubject: { principalRef: "principal:refresh-benchmark", ownerScopeRef },
  adapters: createAdapterSet({ CloudCodeRuntimeClient, CodexRuntimeClient,
    GeminiAdapter, OpenAIAdapter, getModelProfile }, observedFetch),
  // 0.19.1 forwards this catalog wire ID but cannot plan it statically;
  // remove the pinned route when llm-mesh 0.19.2 supplies the catalog mapping.
  createRoutePlanner: (runtime) => variant.provider === "gemini"
    ? createPinnedWirePlanner({ runtime, facade, account, variant,
      routingSubject: { principalRef: "principal:refresh-benchmark", ownerScopeRef },
      affinityKey: document.id, outcomes: routeOutcomes })
    : facade.createRoutePlanner(runtime),
});
const textClient = { mode: "mesh", provider: variant.provider, model: variant.model,
  async generateJson(input) {
    generationStarted = Date.now();
    inputHashes = { schemaSha256: sha256(input.schema), promptSha256: sha256(input.prompt) };
    if (inputHashes.schemaSha256 !== expected.schemaSha256
      || inputHashes.promptSha256 !== expected.promptSha256) throw new Error("Prompt/schema hash mismatch");
    const request = { providerId: variant.provider, modelId: variant.model,
      reasoning: { effort: variant.effort },
      messages: [{ role: "system", content: frozen.systemPrompt }, { role: "user",
        content: `Schema: ${input.schema}\n\n${input.prompt}` }], responseFormat: { type: "json-object" },
      maxOutputTokens: input.maxOutputTokens, signal: controller.signal };
    generated = await mesh.generateValidated(request, async (response) => {
      generated = response;
      const responseText = response.text ?? "";
      await writeFile(rawPath, responseText, "utf8");
      const inspected = inspectResponse(responseText, context, corpus.chunks[0],
        containsNormalizedPdfExcerpt);
      responseValidation = inspected.validation;
      normalizedResponse = inspected.parsed;
      await input.validateResponse(responseText);
    });
    await writeFile(input.outputPath, generated.text ?? "", "utf8");
    return { status: "completed", provider: variant.provider, mode: "mesh", model: variant.model,
      outputPath: input.outputPath, audit: { mesh: true, providerId: variant.provider, modelId: variant.model } };
  } };
let status = "completed";
let error;
let extraction;
const started = Date.now();
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), executionContract.transportTimeoutMs);
try {
  extraction = (await extractRefreshProfile(corpus.chunks, { textClient, context,
    maxOutputTokens: frozen.maxOutputTokens }))[0]?.extraction;
} catch (caught) {
  status = "failed";
  error = errorDetails(caught);
} finally { clearTimeout(timeout); }
const completed = Date.now();
if (responseValidation.jsonValidAfterNormalize) {
  await writeFile(outputPath, JSON.stringify(normalizedResponse), "utf8");
}
const receipt = { schemaVersion: 2, campaign: campaign ?? "v1", caseId, status, t1Commit, profileModuleSha256,
  documentId: document.id, input: { pdfSha256: document.sha256, textSha256: document.textSha256 },
  requested: { providerId: variant.provider, transportProviderId: variant.transport,
    modelId: variant.model, effort: variant.effort,
    maxOutputTokens: frozen.maxOutputTokens,
    transportTimeoutMs: executionContract.transportTimeoutMs }, accountPseudonym, wire,
  actual: generated ? { responseId: generated.id, providerId: generated.providerId,
    modelId: generated.modelId, finishReason: generated.finishReason,
    responseTextSha256: sha256(generated.text ?? ""), usage: generated.usage } : null,
  validation: { ...responseValidation, extractionAccepted: Boolean(extraction),
    accepted: Boolean(extraction), routeOutcomes, fallbackAvailable: false },
  hashes: inputHashes, timing: { startedAt: new Date(started).toISOString(),
    completedAt: new Date(completed).toISOString(), totalMs: completed - started,
    queueMs: wire && generationStarted ? Date.parse(wire.fetchStartedAt) - generationStarted : null,
    runMs: wire ? completed - Date.parse(wire.fetchStartedAt) : null }, attempts: 1,
  extractionAccepted: Boolean(extraction), attemptNumber, retryReason, error,
  artifacts: { receiptPath, rawPath, outputPath: responseValidation.jsonValidAfterNormalize ? outputPath : null } };
await writeFile(receiptPath, JSON.stringify(receipt), "utf8");
console.log(JSON.stringify(receipt));
if (status !== "completed") process.exitCode = 1;
