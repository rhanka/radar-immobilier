import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const required = (name) => process.env[name] || (() => { throw new Error(`${name} is required`); })();
const repositoryRoot = required("BENCHMARK_REPOSITORY_ROOT");
const t1Root = required("BENCHMARK_T1_ROOT");
const resultRoot = required("BENCHMARK_RESULT_ROOT");
const documentId = required("BENCHMARK_DOCUMENT");
const t1Commit = required("BENCHMARK_T1_COMMIT");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const manifest = JSON.parse(await readFile(resolve(repositoryRoot,
  "docs/reviews/refresh-benchmark/v6/manifest.json"), "utf8"));
const document = manifest.documents.find(({ id }) => id === documentId);
if (!document) throw new Error(`Unknown v6 document: ${documentId}`);
const stem = `${document.id}--gemini-low`;
const receiptPath = resolve(resultRoot, `${stem}.receipt.json`);
const rawPath = resolve(resultRoot, `${stem}.raw.txt`);
const outputPath = resolve(resultRoot, `${stem}.output.json`);
const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
const raw = await readFile(rawPath, "utf8");
if (receipt.status !== "completed" || receipt.extractionAccepted !== true
  || receipt.t1Commit !== t1Commit || receipt.actual?.responseTextSha256 !== sha256(raw)) {
  throw new Error("Only a completed, hash-matching product acceptance can be requalified");
}

const profileModulePath = resolve(t1Root, "api/src/services/graph/refresh-profile.ts");
const corpusModulePath = resolve(t1Root, "api/src/services/graph/refresh-corpus.ts");
if (sha256(await readFile(profileModulePath)) !== receipt.profileModuleSha256) {
  throw new Error("T1 profile module differs from the control receipt");
}
const { extractRefreshProfile, loadRefreshProfileContext } = await import(pathToFileURL(profileModulePath));
const { materializeRefreshCorpus } = await import(pathToFileURL(corpusModulePath));
const workerRoot = resolve(manifest.sourceRunRoot, "workers", document.city);
const pdfPath = resolve(workerRoot, "corpus", `${document.sha256}.pdf`);
const pdf = await readFile(pdfPath);
const parsedText = await readFile(resolve(repositoryRoot, document.runtimeTextRelativePath), "utf8");
if (sha256(pdf) !== document.sha256 || sha256(parsedText) !== document.textSha256) {
  throw new Error("Frozen v6 input hash mismatch");
}
const manifestKey = "refresh-benchmark-input.tsv";
const tsv = `source_id\tcity_slug\tsha\trepresentation_key\tsidecar_key\n${document.sourceId}\t${document.city}\t${document.sha256}\t${document.originalKey}\t${document.originalKey}.meta.json\n`;
const reader = { async get(key) {
  if (key === manifestKey) return Buffer.from(tsv);
  if (key === document.originalKey) return pdf;
  if (key === `${document.originalKey}.meta.json`) return readFile(`${pdfPath}.meta.json`);
  throw new Error(`Unexpected input key: ${key}`);
} };
const corpus = await materializeRefreshCorpus({ citySlug: document.city, manifestKey, reader,
  extractPdf: async () => parsedText });
const context = loadRefreshProfileContext({ root: t1Root,
  profilePath: resolve(t1Root, "radar/ontology/ontology-profile.yaml"), unregisteredOnly: true });
const client = { mode: "mesh", provider: "gemini", model: "recorded-response",
  async generateJson(input) {
    await input.validateResponse(raw);
    await mkdir(dirname(input.outputPath), { recursive: true });
    await writeFile(input.outputPath, raw, "utf8");
    return { status: "completed", provider: "gemini", mode: "mesh",
      outputPath: input.outputPath, audit: { offlineRequalification: true } };
  } };
const extraction = (await extractRefreshProfile(corpus.chunks, { textClient: client, context,
  maxOutputTokens: receipt.requested.maxOutputTokens }))[0]?.extraction;
if (!extraction) throw new Error("Recorded response did not pass the product profile");
const previousProfileValid = receipt.validation.profileValid;
const previousProfileViolations = receipt.validation.profileViolations;
receipt.validation = { ...receipt.validation,
  preExpansionProfileValid: previousProfileValid,
  preExpansionProfileViolations: previousProfileViolations,
  profileValid: true, profileViolations: [], provenanceValid: true,
  provenanceViolations: [], accepted: true, validationStage: "post-profile-injection" };
await writeFile(outputPath, JSON.stringify(extraction), "utf8");
await writeFile(receiptPath, JSON.stringify(receipt), "utf8");
console.log(JSON.stringify({ documentId, profileValid: true, provenanceValid: true,
  outputSha256: sha256(JSON.stringify(extraction)) }));
