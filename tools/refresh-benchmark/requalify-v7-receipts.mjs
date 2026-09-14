import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { validateExtraction, validateProfileExtraction } from
  "/workspace/node_modules/@sentropic/graphify/dist/index.js";

const required = (name) => process.env[name] || (() => { throw new Error(`${name} is required`); })();
const repositoryRoot = required("BENCHMARK_REPOSITORY_ROOT");
const resultRoot = required("BENCHMARK_RESULT_ROOT");
const t1Root = required("BENCHMARK_T1_ROOT");
const campaign = process.env.BENCHMARK_CAMPAIGN ?? "v7";
const variant = process.env.BENCHMARK_VARIANT ?? "gemini-low";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const manifest = JSON.parse(await readFile(resolve(repositoryRoot,
  `docs/reviews/refresh-benchmark/${campaign}/manifest.json`), "utf8"));
const profileModulePath = resolve(t1Root, "api/src/services/graph/refresh-profile.ts");
const corpusModulePath = resolve(t1Root, "api/src/services/graph/refresh-corpus.ts");
const { loadRefreshProfileContext } = await import(pathToFileURL(profileModulePath));
const { containsNormalizedPdfExcerpt } = await import(pathToFileURL(corpusModulePath));
const context = loadRefreshProfileContext({ root: t1Root,
  profilePath: resolve(t1Root, "radar/ontology/ontology-profile.yaml"), unregisteredOnly: true });

function parseRaw(raw) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return JSON.parse(fenced ? fenced[1].trim() : trimmed);
}
function injectIdentity(extraction, document) {
  const identity = { source_file: document.originalKey, rawRef: document.originalKey,
    docSha: document.sha256, sourceUrl: document.sourceUrl, modality: "pdf" };
  for (const entity of [...extraction.nodes, ...extraction.edges]) {
    entity.citations = (entity.citations ?? []).map((citation) => ({ ...citation, ...identity }));
  }
}
function provenanceViolations(extraction, document, pages) {
  const violations = [];
  const inspect = (record, path) => {
    if (record.source_file !== document.originalKey || record.rawRef !== document.originalKey
      || record.docSha !== document.sha256 || record.sourceUrl !== document.sourceUrl
      || record.modality !== "pdf") violations.push({ path, code: "invalid_pdf_identity" });
    if (!Number.isInteger(record.page) || record.page < 1 || record.page > pages.length) {
      violations.push({ path, code: "invalid_pdf_page" });
    } else if (typeof record.excerpt !== "string"
      || !containsNormalizedPdfExcerpt(pages[record.page - 1], record.excerpt)) {
      violations.push({ path, code: "ungrounded_pdf_excerpt" });
    }
  };
  extraction.nodes.forEach((node, index) => {
    if (!node.node_type) violations.push({ path: `nodes[${index}]`, code: "untyped_node" });
  });
  for (const [collectionName, entities] of [["nodes", extraction.nodes], ["edges", extraction.edges]]) {
    entities.forEach((entity, entityIndex) => {
      if (entity.source_file !== document.originalKey) {
        violations.push({ path: `${collectionName}[${entityIndex}]`, code: "invalid_entity_source_file" });
      }
      (entity.citations ?? []).forEach((citation, citationIndex) =>
        inspect(citation, `${collectionName}[${entityIndex}].citations[${citationIndex}]`));
    });
  }
  (extraction.evidence ?? []).forEach((item, index) => inspect(item, `evidence[${index}]`));
  return violations;
}

const summary = [];
for (const document of manifest.documents) {
  const stem = `${document.id}--${variant}`;
  const receiptPath = resolve(resultRoot, `${stem}.receipt.json`);
  const raw = await readFile(resolve(resultRoot, `${stem}.raw.txt`), "utf8");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  if (receipt.actual?.responseTextSha256 !== sha256(raw)) throw new Error(`Raw hash mismatch: ${stem}`);
  const extraction = parseRaw(raw);
  const extractionViolations = validateExtraction(extraction);
  const preProfile = extractionViolations.length === 0 ? validateProfileExtraction(extraction,
    { profile: context.profile, registryExtraction: context.registryExtraction }) : null;
  injectIdentity(extraction, document);
  const profile = extractionViolations.length === 0 ? validateProfileExtraction(extraction,
    { profile: context.profile, registryExtraction: context.registryExtraction }) : null;
  const text = await readFile(resolve(repositoryRoot, document.runtimeTextRelativePath), "utf8");
  const pages = text.split("\f"); if (pages.at(-1) === "") pages.pop();
  const provenance = profile?.valid ? provenanceViolations(extraction, document, pages) : [];
  const computedAccepted = extractionViolations.length === 0 && profile?.valid && provenance.length === 0;
  if (computedAccepted !== receipt.validation.accepted) throw new Error(`Acceptance mismatch: ${stem}`);
  receipt.validation = { ...receipt.validation, extractionValid: extractionViolations.length === 0,
    extractionViolations, preExpansionProfileValid: preProfile?.valid ?? null,
    preExpansionProfileViolations: preProfile?.issues ?? [], profileValid: profile?.valid ?? null,
    profileViolations: profile?.issues ?? [], provenanceValid: profile?.valid ? provenance.length === 0 : null,
    provenanceViolations: provenance, validationStage: "post-profile-injection-offline" };
  await writeFile(receiptPath, JSON.stringify(receipt), "utf8");
  summary.push({ documentId: document.id, profileValid: receipt.validation.profileValid,
    provenanceValid: receipt.validation.provenanceValid, accepted: receipt.validation.accepted });
}
console.log(JSON.stringify(summary));
