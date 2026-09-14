import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { validateExtraction, validateProfileExtraction } from
  "/workspace/node_modules/@sentropic/graphify/dist/index.js";

import { executionContract } from "./integration-contract.mjs";

const required = (name) => process.env[name] || (() => { throw new Error(`${name} is required`); })();
const repositoryRoot = required("BENCHMARK_REPOSITORY_ROOT");
const resultRoot = required("BENCHMARK_RESULT_ROOT");
const t1Root = required("BENCHMARK_T1_ROOT");
const campaign = process.env.BENCHMARK_CAMPAIGN ?? "v14";
const variant = process.env.BENCHMARK_VARIANT ?? "gemini-low";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const manifest = JSON.parse(await readFile(resolve(repositoryRoot,
  `docs/reviews/refresh-benchmark/${campaign}/manifest.json`), "utf8"));
const profileModulePath = resolve(t1Root, "api/src/services/graph/refresh-profile.ts");
const corpusModulePath = resolve(t1Root, "api/src/services/graph/refresh-corpus.ts");
const profileSource = await readFile(profileModulePath, "utf8");
const { loadRefreshProfileContext, parseStrictJsonResponse,
  REFRESH_PROFILE_CONTRACT_VERSION } = await import(pathToFileURL(profileModulePath));
const { containsNormalizedPdfExcerpt } = await import(pathToFileURL(corpusModulePath));

// normalizeEntityCitations and its bounds are module-private, so the offline mirror below
// restates them. Both constants are asserted against the module source: if the production
// contract moves, requalification stops instead of scoring a stale rule.
const MAX_CITATION_EXCERPT_CODE_POINTS = 200;
const MIN_CITATION_EXCERPT_CODE_POINTS = 20;
if (!profileSource.includes(`MAX_CITATION_EXCERPT_CODE_POINTS = ${MAX_CITATION_EXCERPT_CODE_POINTS}`)
  || !profileSource.includes(`MIN_CITATION_EXCERPT_CODE_POINTS = ${MIN_CITATION_EXCERPT_CODE_POINTS}`)) {
  throw new Error("Offline citation bounds no longer mirror the profile module");
}
// v9 enforces the lower bound in the validator, by name and before anchoring. The mirror asserts
// the production violation name too, so an offline run can never score a rule the product dropped.
if (!profileSource.includes("entity_citation_excerpt_too_short")) {
  throw new Error("Offline short-excerpt rule no longer mirrors the profile module");
}
if (REFRESH_PROFILE_CONTRACT_VERSION !== "immo-pv-extraction-v9") {
  throw new Error(`Unexpected contract version: ${REFRESH_PROFILE_CONTRACT_VERSION}`);
}
const context = loadRefreshProfileContext({ root: t1Root,
  profilePath: resolve(t1Root, "radar/ontology/ontology-profile.yaml"), unregisteredOnly: true });

// Mirror of validateDeclaredContractVersion: an absent version keeps v4 compatibility, a
// declared version must match v9 exactly, and the key is stripped before schema validation.
function applyDeclaredContractVersion(extraction) {
  if (!("contract_version" in extraction)) return null;
  const declared = extraction["contract_version"];
  delete extraction["contract_version"];
  return declared === REFRESH_PROFILE_CONTRACT_VERSION
    ? null : { path: "contract_version", code: "contract_version_mismatch", declared };
}

// Mirror of normalizeEntityCitations: the constant PDF identity is injected and the excerpt is
// bounded by truncation to its first 200 code points, before validation and before anchoring.
function normalizeEntityCitations(extraction, document) {
  const identity = { source_file: document.originalKey, rawRef: document.originalKey,
    docSha: document.sha256, sourceUrl: document.sourceUrl, modality: "pdf" };
  let truncated = 0;
  for (const collection of [extraction.nodes, extraction.edges]) {
    if (!Array.isArray(collection)) continue;
    for (const entity of collection) {
      if (!entity || typeof entity !== "object" || Array.isArray(entity)) continue;
      if (!Array.isArray(entity.citations)) continue;
      entity.citations = entity.citations.map((citation) => {
        if (!citation || typeof citation !== "object" || Array.isArray(citation)) return citation;
        const merged = { ...citation, ...identity };
        if (typeof merged.excerpt === "string") {
          const points = [...merged.excerpt];
          if (points.length > MAX_CITATION_EXCERPT_CODE_POINTS) truncated += 1;
          merged.excerpt = points.slice(0, MAX_CITATION_EXCERPT_CODE_POINTS).join("");
        }
        return merged;
      });
    }
  }
  return truncated;
}

// Mirror of validateProvenance under v9: entity citations are never rejected for being too long
// (truncation happened above), but a string excerpt under 20 code points is refused by name,
// before the page anchor is checked. evidence[] keeps its own unbounded contract.
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
      (entity.citations ?? []).forEach((citation, citationIndex) => {
        const path = `${collectionName}[${entityIndex}].citations[${citationIndex}]`;
        if (typeof citation.excerpt === "string"
          && [...citation.excerpt].length < MIN_CITATION_EXCERPT_CODE_POINTS) {
          violations.push({ path, code: "entity_citation_excerpt_too_short",
            codePoints: [...citation.excerpt].length });
          return;
        }
        inspect(citation, path);
      });
    });
  }
  (extraction.evidence ?? []).forEach((item, index) => inspect(item, `evidence[${index}]`));
  return violations;
}

// The contract allows one retry after a transport failure: attempt 2 is then the terminal attempt.
async function terminalStem(baseStem) {
  const retried = `${baseStem}.attempt-${executionContract.maxAttempts}`;
  return access(resolve(resultRoot, `${retried}.receipt.json`)).then(() => retried, () => baseStem);
}

const summary = [];
for (const document of manifest.documents) {
  const stem = await terminalStem(`${document.id}--${variant}`);
  const receiptPath = resolve(resultRoot, `${stem}.receipt.json`);
  let receipt;
  try { receipt = JSON.parse(await readFile(receiptPath, "utf8")); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    summary.push({ documentId: document.id, state: "not_launched" });
    continue;
  }
  // A transport failure never reaches the raw persistence step: there is nothing to requalify.
  if (!receipt.actual) {
    summary.push({ documentId: document.id, profileValid: null, provenanceValid: null,
      accepted: receipt.validation.accepted, state: "transport_failed" });
    continue;
  }
  const raw = await readFile(resolve(resultRoot, `${stem}.raw.txt`), "utf8");
  if (receipt.actual?.responseTextSha256 !== sha256(raw)) throw new Error(`Raw hash mismatch: ${stem}`);
  let extraction;
  let parseError = null;
  try { extraction = parseStrictJsonResponse(raw); }
  catch (error) { parseError = { name: error.name, message: error.message }; }
  if (parseError || !extraction || typeof extraction !== "object" || Array.isArray(extraction)) {
    if (receipt.validation.accepted) throw new Error(`Acceptance mismatch: ${stem}`);
    summary.push({ documentId: document.id, state: "unparsable", accepted: false });
    continue;
  }
  const versionViolation = applyDeclaredContractVersion(extraction);
  const preProfileExtractionViolations = validateExtraction(extraction);
  const preProfile = preProfileExtractionViolations.length === 0
    ? validateProfileExtraction(extraction,
      { profile: context.profile, registryExtraction: context.registryExtraction }) : null;
  const truncatedExcerpts = normalizeEntityCitations(extraction, document);
  const extractionViolations = validateExtraction(extraction);
  const profile = extractionViolations.length === 0 ? validateProfileExtraction(extraction,
    { profile: context.profile, registryExtraction: context.registryExtraction }) : null;
  const text = await readFile(resolve(repositoryRoot, document.runtimeTextRelativePath), "utf8");
  const pages = text.split("\f"); if (pages.at(-1) === "") pages.pop();
  const provenance = profile?.valid ? provenanceViolations(extraction, document, pages) : [];
  const computedAccepted = versionViolation === null && extractionViolations.length === 0
    && Boolean(profile?.valid) && provenance.length === 0;
  if (computedAccepted !== receipt.validation.accepted) throw new Error(`Acceptance mismatch: ${stem}`);
  receipt.validation = { ...receipt.validation, extractionValid: extractionViolations.length === 0,
    extractionViolations, contractVersionViolations: versionViolation ? [versionViolation] : [],
    truncatedEntityCitationExcerpts: truncatedExcerpts,
    preExpansionProfileValid: preProfile?.valid ?? null,
    preExpansionProfileViolations: preProfile?.issues ?? [], profileValid: profile?.valid ?? null,
    profileViolations: profile?.issues ?? [], provenanceValid: profile?.valid ? provenance.length === 0 : null,
    provenanceViolations: provenance, validationStage: "post-citation-normalization-offline" };
  await writeFile(receiptPath, JSON.stringify(receipt), "utf8");
  summary.push({ documentId: document.id, profileValid: receipt.validation.profileValid,
    provenanceValid: receipt.validation.provenanceValid, truncatedExcerpts,
    accepted: receipt.validation.accepted });
}
console.log(JSON.stringify(summary));
