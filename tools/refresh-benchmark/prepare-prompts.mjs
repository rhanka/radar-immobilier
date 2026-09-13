import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const required = (name) => process.env[name] || (() => { throw new Error(`${name} is required`); })();
const repositoryRoot = required("BENCHMARK_REPOSITORY_ROOT");
const t1Root = required("BENCHMARK_T1_ROOT");
const t1Commit = required("BENCHMARK_T1_COMMIT");
const maxOutputTokens = 16_384;
const systemPrompt = "You are Graphify's JSON extraction backend. Return only valid JSON matching the requested schema. Do not include Markdown prose outside the JSON object.";
const manifest = JSON.parse(await readFile(resolve(repositoryRoot,
  "docs/reviews/refresh-benchmark/manifest.json"), "utf8"));
const profileModulePath = resolve(t1Root, "api/src/services/graph/refresh-profile.ts");
const corpusModulePath = resolve(t1Root, "api/src/services/graph/refresh-corpus.ts");
const profileModuleSha256 = sha256(await readFile(profileModulePath));
const corpusModuleSha256 = sha256(await readFile(corpusModulePath));
const { extractRefreshProfile, loadRefreshProfileContext } = await import(pathToFileURL(profileModulePath));
const { materializeRefreshCorpus } = await import(pathToFileURL(corpusModulePath));

const documents = [];
for (const document of manifest.documents) {
  const workerRoot = resolve(manifest.sourceRunRoot, "workers", document.city);
  const pdfPath = resolve(workerRoot, "corpus", `${document.sha256}.pdf`);
  const parsedPath = resolve(repositoryRoot, document.runtimeTextRelativePath);
  const pdf = await readFile(pdfPath);
  const parsedText = await readFile(parsedPath, "utf8");
  if (sha256(pdf) !== document.sha256 || sha256(parsedText) !== document.textSha256) {
    throw new Error(`Frozen input hash mismatch: ${document.id}`);
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
  if (corpus.chunks.length !== 1) throw new Error(`Expected one T1 chunk: ${document.id}`);
  const context = loadRefreshProfileContext({ root: t1Root,
    profilePath: resolve(t1Root, "radar/ontology/ontology-profile.yaml"), unregisteredOnly: true });
  let captured;
  const sentinel = new Error("prompt captured");
  try {
    await extractRefreshProfile(corpus.chunks, { context, maxOutputTokens,
      textClient: { mode: "mesh", provider: "openai", model: "frozen-at-runtime",
        async generateJson(input) { captured = input; throw sentinel; } } });
  } catch (error) {
    if (error !== sentinel) throw error;
  }
  if (!captured) throw new Error(`No prompt captured: ${document.id}`);
  documents.push({ id: document.id, chunkId: corpus.chunks[0].id,
    pages: corpus.chunks[0].pages, schemaSha256: sha256(captured.schema),
    promptSha256: sha256(captured.prompt), schemaBytes: Buffer.byteLength(captured.schema),
    promptBytes: Buffer.byteLength(captured.prompt) });
}
console.log(JSON.stringify({ schemaVersion: 1, frozenAt: new Date().toISOString(),
  t1Commit, profileModuleSha256, corpusModuleSha256, graphifyVersion: "0.18.0",
  meshVersion: "0.19.0", maxOutputTokens, systemPrompt,
  systemPromptSha256: sha256(systemPrompt), documents }, null, 2));
