// bench-v11: validate seat outputs with the exact v10 chains.
// Diagnostic chain = run-case.mjs inspectResponse (J/V/Pr classes).
// Acceptance gate = frozen refresh-profile.ts validatedExtraction
// (strict fence, contract version, identity injection + 200cp truncation,
// validateExtraction, validateProfileExtraction, validateProvenance).
// Usage: node validate-outputs.mjs <armDir>  (reads <armDir>/raw/*.txt)
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";

const DIR = process.env.BENCH_DIR ?? new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const graphify = await import("@sentropic/graphify").catch(() => import(
  `${DIR}/sandbox/node_modules/@sentropic/graphify/dist/index.js`));
const { loadOntologyProfile, registryRecordsToExtraction,
  validateExtraction, validateProfileExtraction } = graphify;

const MIN_ANCHOR = 12;
const MIN_CITATION = 20;
const MAX_CITATION = 200;
const normalizePdfExcerpt = (v) => v.normalize("NFKC").normalize("NFD")
  .replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const containsNormalizedPdfExcerpt = (pageText, excerpt) => {
  const n = normalizePdfExcerpt(excerpt);
  return [...n].length >= MIN_ANCHOR && normalizePdfExcerpt(pageText).includes(n);
};
function strictJsonCandidate(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return { text: fenced ? fenced[1].trim() : trimmed, wrapperNormalized: Boolean(fenced) };
}
const parseErrorDetails = (error, _source) => {
  if (!(error instanceof SyntaxError)) return null;
  const match = error.message.match(/(?:at )?position\s+(\d+)/iu);
  return { name: error.name, message: error.message,
    position: match ? Number(match[1]) : null };
};
const pageTexts = (chunkText) => {
  const markers = [...chunkText.matchAll(/^\[PDF PAGE ([1-9]\d*)\]\n/gm)];
  return new Map(markers.map((marker, index) => {
    const start = marker.index + marker[0].length;
    return [Number(marker[1]), chunkText.slice(start, markers[index + 1]?.index ?? chunkText.length)];
  }));
};

// ---- diagnostic chain (run-case.mjs, exact port) ----
function provenanceViolations(extraction, chunk, texts) {
  const violations = [];
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

function inspectResponse(text, context, chunk) {
  const texts = pageTexts(chunk.text);
  let rawParseError = null;
  try { JSON.parse(text); } catch (error) { rawParseError = parseErrorDetails(error, text); }
  const normed = strictJsonCandidate(text);
  let parsed;
  let normalizedParseError = null;
  try { parsed = JSON.parse(normed.text); } catch (error) {
    normalizedParseError = parseErrorDetails(error, normed.text);
  }
  const validation = { jsonValidRaw: rawParseError === null,
    wrapperNormalized: normed.wrapperNormalized,
    jsonValidAfterNormalize: normalizedParseError === null,
    extractionValid: null, extractionViolations: [], profileValid: null,
    profileViolations: [], provenanceValid: null, provenanceViolations: [],
    preExpansionProfileValid: null, preExpansionProfileViolations: [] };
  if (normalizedParseError) return { validation, parsed: undefined };
  validation.extractionViolations = validateExtraction(parsed);
  validation.extractionValid = validation.extractionViolations.length === 0;
  if (!validation.extractionValid) return { validation, parsed };
  const profile = validateProfileExtraction(parsed, { profile: context.profile,
    registryExtraction: context.registryExtraction });
  validation.preExpansionProfileValid = profile.valid;
  validation.preExpansionProfileViolations = profile.issues;
  validation.profileValid = profile.valid;
  validation.profileViolations = profile.issues;
  if (!profile.valid) return { validation, parsed };
  validation.provenanceViolations = provenanceViolations(parsed, chunk, texts);
  validation.provenanceValid = validation.provenanceViolations.length === 0;
  return { validation, parsed };
}

// ---- acceptance gate (frozen refresh-profile.ts, exact port) ----
function parseStrictJsonResponse(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return JSON.parse(trimmed);
  const firstLineEnd = trimmed.indexOf("\n");
  if (firstLineEnd < 0) throw new SyntaxError("Invalid JSON fence: missing body line");
  const rawLabel = trimmed.slice(3, firstLineEnd);
  const label = rawLabel.endsWith("\r") ? rawLabel.slice(0, -1) : rawLabel;
  if (label !== "" && label.toLowerCase() !== "json") {
    throw new SyntaxError("Invalid JSON fence: expected an empty or json label");
  }
  const closingLineStart = trimmed.lastIndexOf("\n");
  if (closingLineStart === firstLineEnd || trimmed.slice(closingLineStart + 1) !== "```") {
    throw new SyntaxError("Invalid JSON fence: missing final closing fence");
  }
  return JSON.parse(trimmed.slice(firstLineEnd + 1, closingLineStart).trim());
}
const pdfIdentityFor = (chunk) => ({ source_file: chunk.originalKey, rawRef: chunk.originalKey,
  docSha: chunk.docSha, sourceUrl: chunk.sourceUrl, modality: "pdf" });
function normalizeEntityCitations(value, chunk) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const root = value;
  const identity = pdfIdentityFor(chunk);
  for (const collection of [root.nodes, root.edges]) {
    if (!Array.isArray(collection)) continue;
    for (const entity of collection) {
      if (!entity || typeof entity !== "object" || Array.isArray(entity)) continue;
      if (!Array.isArray(entity.citations)) continue;
      entity.citations = entity.citations.map((citation) => {
        if (!citation || typeof citation !== "object" || Array.isArray(citation)) return citation;
        const merged = { ...citation, ...identity };
        if (typeof merged.excerpt === "string") {
          merged.excerpt = Array.from(merged.excerpt).slice(0, MAX_CITATION).join("");
        }
        return merged;
      });
    }
  }
  return value;
}
function validatePdfRecord(value, chunk, pageTextsMap) {
  if (value.source_file !== chunk.originalKey || value.rawRef !== chunk.originalKey
    || value.docSha !== chunk.docSha || value.sourceUrl !== chunk.sourceUrl
    || value.modality !== "pdf") throw new Error("invalid original PDF identity");
  const page = value.page;
  if (!Number.isInteger(page) || !chunk.pages.includes(page)) throw new Error("invalid original PDF page");
  const excerpt = value.excerpt;
  if (typeof excerpt !== "string") throw new Error("ungrounded PDF excerpt");
  if ([...normalizePdfExcerpt(excerpt)].length < MIN_ANCHOR) throw new Error("excerpt_below_anchor_floor");
  if (!containsNormalizedPdfExcerpt(pageTextsMap.get(page) ?? "", excerpt)) throw new Error("ungrounded PDF excerpt");
}
function validateEntityCitationExcerpt(value) {
  const excerpt = value.excerpt;
  if (typeof excerpt !== "string") return;
  if (Array.from(excerpt).length < MIN_CITATION || [...normalizePdfExcerpt(excerpt)].length < MIN_ANCHOR) {
    throw new Error("entity_citation_excerpt_too_short");
  }
}
function validateProvenance(extraction, chunk, pageTextsMap) {
  if (extraction.nodes.some((node) => !node.node_type)) throw new Error("Untyped node");
  for (const entity of [...extraction.nodes, ...extraction.edges, ...(extraction.hyperedges ?? [])]) {
    if (entity.source_file !== chunk.originalKey) throw new Error("Invalid source_file");
  }
  for (const entity of [...extraction.nodes, ...extraction.edges]) {
    for (const citation of entity.citations ?? []) {
      validateEntityCitationExcerpt(citation);
      validatePdfRecord(citation, chunk, pageTextsMap);
    }
  }
  for (const evidence of extraction.evidence ?? []) validatePdfRecord(evidence, chunk, pageTextsMap);
}
function validatedExtraction(text, chunk, context, pageTextsMap) {
  let parsed;
  try { parsed = parseStrictJsonResponse(text); }
  catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Invalid JSON: ${error.message}`);
    throw error;
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    if ("contract_version" in parsed) {
      if (parsed.contract_version !== "immo-pv-extraction-v9") throw new Error("contract_version_mismatch");
      delete parsed.contract_version;
    }
  }
  normalizeEntityCitations(parsed, chunk);
  const baseErrors = validateExtraction(parsed);
  if (baseErrors.length > 0) throw new Error(`Invalid Graphify extraction: ${baseErrors.join("; ")}`);
  const profileResult = validateProfileExtraction(parsed, { profile: context.profile,
    registryExtraction: context.registryExtraction });
  if (!profileResult.valid) throw new Error(`Invalid profile extraction: ${profileResult.issues
    .filter((i) => i.severity === "error").map((i) => i.code).join(",")}`);
  validateProvenance(parsed, chunk, pageTextsMap);
  return parsed;
}

const armDir = process.argv[2];
if (!armDir) throw new Error("usage: validate-outputs.mjs <armDir>");
const profile = loadOntologyProfile(`${DIR}/t1/frozen-ontology-profile.yaml`);
const context = { profile, registries: {}, registryExtraction: registryRecordsToExtraction({}, profile) };
const onlyDoc = process.argv[3] ?? null;

const rawDir = `${armDir}/raw`;
const files = (await readdir(rawDir)).filter((f) => f.endsWith(".txt") && (!onlyDoc || f.includes(onlyDoc)));
await mkdir(`${armDir}/validated`, { recursive: true });
const rows = [];
for (const file of files.sort()) {
  const docId = file.replace(/\.txt$/, "").split("--").slice(1).join("--");
  const variant = file.replace(/\.txt$/, "").split("--")[0];
  const chunk = JSON.parse(await readFile(`${DIR}/full/chunks/${docId}.json`, "utf8"));
  const texts = pageTexts(chunk.text);
  const raw = await readFile(`${rawDir}/${file}`, "utf8");
  const { validation } = inspectResponse(raw, context, chunk);
  let accepted = null;
  let gateError = null;
  try { accepted = validatedExtraction(raw, chunk, context, texts); }
  catch (error) { gateError = String(error.message).slice(0, 300); }
  if (accepted) {
    // run-case.mjs parity: an accepted extraction overrides the diagnostic flags.
    validation.profileValid = true;
    validation.profileViolations = [];
    validation.provenanceValid = true;
    validation.provenanceViolations = [];
  }
  const failureClass = accepted ? null
    : !validation.jsonValidAfterNormalize ? "json"
    : !validation.extractionValid || !validation.profileValid ? "profile"
    : "provenance";
  if (accepted) await writeFile(`${armDir}/validated/${variant}--${docId}.output.json`, JSON.stringify(accepted));
  const receipt = { caseId: `${docId}--${variant}`, status: accepted ? "completed" : "failed",
    validation: { ...validation, accepted: Boolean(accepted), failureClass, gateError } };
  await writeFile(`${armDir}/validated/${variant}--${docId}.receipt.json`, JSON.stringify(receipt));
  rows.push({ doc: docId, accepted: Boolean(accepted), failureClass });
}
const acc = rows.filter((r) => r.accepted).length;
console.log(`validated=${rows.length} accepted=${acc} J=${rows.filter((r) => r.failureClass === "json").length} V=${rows.filter((r) => r.failureClass === "profile").length} Pr=${rows.filter((r) => r.failureClass === "provenance").length}`);
