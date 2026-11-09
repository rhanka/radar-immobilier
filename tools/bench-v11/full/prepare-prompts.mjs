// bench-v11: rebuild the frozen v101b prompts byte-exact and verify against
// manifest.promptFreeze (schemaSha256 / promptSha256 / byte lengths).
// Ports chunkDocument (frozen refresh-corpus.ts @93994e4) + schemaFor (frozen
// refresh-profile.ts @93994e4); prompt body via @sentropic/graphify@0.18.0.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const DIR = "/home/antoinefa/src/radar-immobilier-bench/tmp/bench-wonder";
const require = createRequire(`${DIR}/sandbox/package.json`);
const graphify = await import("@sentropic/graphify").catch(() => import(`${DIR}/sandbox/node_modules/@sentropic/graphify/dist/index.js`));
const { buildProfileChunkPrompt, loadOntologyProfile, registryRecordsToExtraction } = graphify;

const sha256Hex = (s) => createHash("sha256").update(s).digest("hex");
const MIN_ANCHOR_NORMALIZED_CODE_POINTS = 12;
const MIN_CITATION_EXCERPT_CODE_POINTS = 20;
const CONTRACT = "immo-pv-extraction-v9";

function splitBounded(text, maxBytes) {
  const parts = [];
  let part = "";
  let bytes = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character);
    if (part && bytes + size > maxBytes) { parts.push(part); part = ""; bytes = 0; }
    part += character;
    bytes += size;
  }
  if (part) parts.push(part);
  return parts;
}

function chunkDocument(doc) {
  const totalBytes = doc.pages.reduce((sum, page) => sum + Buffer.byteLength(page.text), 0);
  const maxBytes = totalBytes <= 200_000 ? 200_000 : totalBytes <= 400_000 ? 120_000 : 30_000;
  const chunks = [];
  for (const page of doc.pages) {
    const marker = `[PDF PAGE ${page.page}]\n`;
    for (const part of splitBounded(page.text, maxBytes - Buffer.byteLength(marker) - 2)) {
      const bytes = Buffer.byteLength(marker) + Buffer.byteLength(part) + 2;
      let current = chunks.at(-1);
      if (!current || current.bytes + bytes > maxBytes) {
        current = { pages: [], parts: [], bytes: 0 };
        chunks.push(current);
      }
      current.pages.push(page.page);
      current.parts.push(`${marker}${part}`);
      current.bytes += bytes;
    }
  }
  return chunks.map((chunk, index) => ({
    id: `${doc.sha256}.${index + 1}`,
    docSha: doc.sha256,
    originalKey: doc.originalKey,
    sourceUrl: doc.sourceUrl,
    pages: [...new Set(chunk.pages)],
    text: chunk.parts.join("\n\n"),
  }));
}

const allowedNodeTypes = (context) => Object.entries(context.profile.node_types)
  .filter(([, spec]) => !spec.registry || spec.registry in context.registries).map(([type]) => type);
const pdfIdentityFor = (chunk) => ({ source_file: chunk.originalKey, rawRef: chunk.originalKey,
  docSha: chunk.docSha, sourceUrl: chunk.sourceUrl, modality: "pdf" });

function schemaFor(chunk, context) {
  const allowed = new Set(allowedNodeTypes(context));
  const statuses = [...context.profile.hardening.statuses];
  const properties = Object.fromEntries(Object.entries(context.profile.node_types)
    .filter(([type]) => allowed.has(type)).map(([type, spec]) => {
      const nodeProperties = spec.properties;
      return [type, { ...nodeProperties, status: { type: "string", enum: statuses,
        description: "Exact node status accepted by the product validator." } }];
    }));
  const evidenceRelations = new Set(context.profile.evidence_policy.relation_types);
  const relations = Object.fromEntries(Object.entries(context.profile.relation_types).flatMap(([type, spec]) => {
    const sourceNodeTypes = spec.source_types.filter((nodeType) => allowed.has(nodeType));
    const targetNodeTypes = spec.target_types.filter((nodeType) => allowed.has(nodeType));
    return sourceNodeTypes.length && targetNodeTypes.length ? [[type, {
      source_node_types: sourceNodeTypes, target_node_types: targetNodeTypes,
      requires_evidence_refs: spec.requires_evidence || evidenceRelations.has(type),
    }]] : [];
  }));
  const pdfIdentity = pdfIdentityFor(chunk);
  const pdfIdentityProperties = Object.fromEntries(Object.entries(pdfIdentity)
    .map(([key, value]) => [key, { const: value }]));
  const entityCitation = { type: "object", required: ["page", "excerpt"],
    properties: { page: { enum: chunk.pages },
      excerpt: { type: "string", minLength: MIN_CITATION_EXCERPT_CODE_POINTS,
        maxLength: 200,
        description: "Exact beginning of the decision sentence, 20 to 200 characters, "
          + "copied verbatim and never completed or corrected. A field label such as "
          + "\"Zone : RUR-12\" is a property, never an excerpt." } },
    description: "The profile injects the constant PDF identity and bounds the excerpt before validation; "
      + "an entity citation excerpt under 20 code points, or under "
      + `${MIN_ANCHOR_NORMALIZED_CODE_POINTS} once normalized to letters and digits, `
      + "is refused as entity_citation_excerpt_too_short." };
  return JSON.stringify({
    contract_version: CONTRACT,
    type: "Graphify Extraction",
    required: ["nodes", "edges", "input_tokens", "output_tokens"],
    ontology: { profile_id: context.profile.id, profile_version: context.profile.version,
      allowed_node_types: [...allowed], node_properties: properties, relation_signatures: relations },
    graph_contract: {
      node_file_type: ["code", "concept", "document", "image", "paper", "rationale"],
      edge_confidence: ["AMBIGUOUS", "EXTRACTED", "INFERRED"],
      entity_source_file: { const: chunk.originalKey },
      evidence_refs: { type: "array", items: { type: "string", references: "evidence[].id" },
        minItems: context.profile.evidence_policy.min_refs,
        required_for_node_types: context.profile.evidence_policy.node_types,
        required_for_relation_types: Object.keys(relations), required_for: ["every edge"] },
      entity_citations: { node_field: "nodes[].citations", edge_field: "edges[].citations",
        required_for: ["every node", "every edge"], type: "array", minItems: 1, items: entityCitation,
        description: "Emit only page and excerpt; the profile injects the constant PDF identity." },
    },
    evidence: { pdf_identity: pdfIdentity, allowedPages: chunk.pages,
      evidence_item: { type: "object",
        required: ["id", "source_file", "rawRef", "docSha", "sourceUrl", "modality", "page", "excerpt"],
        properties: { id: { type: "string", minLength: 1 }, ...pdfIdentityProperties,
          page: { enum: chunk.pages },
          excerpt: { type: "string", minLength: MIN_ANCHOR_NORMALIZED_CODE_POINTS,
            description: "Verbatim text from the cited page, at least "
              + `${MIN_ANCHOR_NORMALIZED_CODE_POINTS} characters once normalized to letters and `
              + "digits only, case and accents folded; a shorter excerpt is refused as "
              + "excerpt_below_anchor_floor. Unlike an entity citation, an evidence item repeats "
              + "the full PDF identity above and is never truncated." } } } },
    constraints: ["Omit facts absent from the chunk, including in-force status and residential unit counts.",
      "An empty nodes/edges/evidence extraction is valid; the enclosing chunk retains the verified PDF identity."],
  });
}

const CONTRACT_PROMPT = (allowed) => `Contract ${CONTRACT}. Emit only these node types: ${allowed.join(", ")}.
Every node file_type must be "document" for this PDF. Edge confidence, when present, must be
"AMBIGUOUS", "EXTRACTED", or "INFERRED"; never emit a numeric confidence.
Node status is type-specific: use only ontology.node_properties.<node_type>.status.enum. These enums
are generated from, and exactly align with, the allowed_statuses list below.
Every entity must use the exact PDF identity in the schema. Evidence refs are
non-empty arrays of string IDs from evidence[].id, never embedded objects. Evidence refs do not replace citations.
Every edge must carry at least one evidence_refs ID that exists in evidence[]. Minimal example:
{"edges":[{"evidence_refs":["ev-1"]}],"evidence":[{"id":"ev-1"}]}.
Every node and every edge must include a non-empty citations array. Each citation must contain only page
and excerpt. The excerpt is the exact beginning of the cited passage, between 20 and 200 characters;
never complete or correct it.
The excerpt carries the act, never a bare field label. A line that is only a label and a code, such as
"Zone : RUR-12" or "Lot : 5 662 886", is a property: put the zone code in the node property (Zone.code,
or zone_ref on Signal and DesignationEvent) and cite the sentence that states the act instead.
Contrastive example, both lines taken from the same real PV page:
excerpt "Zone : RUR-12" is refused; excerpt
"QUE le conseil municipal autorise, sur recommandation du CCU," is correct.
On an agenda, which lists planned items rather than decisions taken, the listed item is the act itself:
cite that agenda line. Never return an empty extraction merely because the document carries no
decision sentence.
Any entity citation excerpt under 20 characters is refused as entity_citation_excerpt_too_short, before
the page anchor is even checked: keep copying the page verbatim from that point
until you pass 20 characters, without inventing the continuation.
Do not repeat the document identity inside citations; the profile
injects it before validation. Follow the relation source/target signatures exactly. Copy every excerpt
exactly as it appears in the PDF text, including mistakes, spacing, and typography; correct nothing.
Contrastive example: if the PDF text says "YvesMalouin", keep "YvesMalouin"; never "Yves-Malouin".
If no supported fact is grounded in the PDF, return empty nodes, edges, and evidence.

`;

const manifest = JSON.parse(await readFile(`${DIR}/harness/manifest-v101b.json`, "utf8"));
const frozenSystem = manifest.promptFreeze.systemPrompt;
if (sha256Hex(frozenSystem) !== "bdc1327904ac4c5a36b91dfdbe887a6f1a900b8fe5f1427249e54d83c250d461") {
  throw new Error("system prompt hash mismatch");
}
const profile = loadOntologyProfile(`${DIR}/t1/frozen-ontology-profile.yaml`);
const context = { profile, registries: {}, registryExtraction: registryRecordsToExtraction({}, profile) };

await mkdir(`${DIR}/full/prompts`, { recursive: true });
const rows = [];
let fail = 0;
for (const doc of manifest.documents) {
  const expected = manifest.promptFreeze.documents.find(({ id }) => id === doc.id);
  const text = await readFile(`${DIR}/full/corpus/text/${doc.id}.txt`, "utf8");
  const pageTexts = text.split("\f");
  if (pageTexts.at(-1) === "") pageTexts.pop();
  const chunks = chunkDocument({ sha256: doc.sha256, originalKey: doc.originalKey,
    sourceUrl: doc.sourceUrl, pages: pageTexts.map((t, i) => ({ page: i + 1, text: t })) });
  const chunk = chunks[0];
  const chunkOk = chunks.length === 1 && chunk.id === expected.chunkId
    && JSON.stringify(chunk.pages) === JSON.stringify(expected.pages);
  const schema = schemaFor(chunk, context);
  const prompt = CONTRACT_PROMPT(allowedNodeTypes(context)) + buildProfileChunkPrompt(context, {
    filePath: chunk.originalKey, fileType: "document", text: chunk.text });
  const schemaOk = sha256Hex(schema) === expected.schemaSha256 && Buffer.byteLength(schema) === expected.schemaBytes;
  const promptOk = sha256Hex(prompt) === expected.promptSha256 && Buffer.byteLength(prompt) === expected.promptBytes;
  if (!chunkOk || !schemaOk || !promptOk) {
    fail += 1;
    console.log(`${doc.id} MISMATCH chunk=${chunkOk} schema=${schemaOk} prompt=${promptOk} gotS=${sha256Hex(schema).slice(0,12)} wantS=${expected.schemaSha256.slice(0,12)} gotP=${sha256Hex(prompt).slice(0,12)} wantP=${expected.promptSha256.slice(0,12)}`);
    continue;
  }
  const user = `Schema: ${schema}\n\n${prompt}`;
  await mkdir(`${DIR}/full/chunks`, { recursive: true });
  await writeFile(`${DIR}/full/chunks/${doc.id}.json`, JSON.stringify(chunk));
  await writeFile(`${DIR}/full/prompts/${doc.id}.system.txt`, `${frozenSystem}\n`);
  await writeFile(`${DIR}/full/prompts/${doc.id}.user.txt`, user);
  await writeFile(`${DIR}/full/prompts/${doc.id}.muse.txt`, `${frozenSystem}\n\n${user}`);
  rows.push({ id: doc.id, schemaBytes: Buffer.byteLength(schema), promptBytes: Buffer.byteLength(prompt), ok: true });
}
await writeFile(`${DIR}/full/prompts/verify.json`, JSON.stringify({ count: rows.length, fail, rows }, null, 1));
console.log(`DONE ok=${rows.length} fail=${fail}`);
if (fail > 0) process.exitCode = 1;
