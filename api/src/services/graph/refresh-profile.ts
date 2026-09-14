import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  buildProfileChunkPrompt,
  discoverProjectConfig,
  loadOntologyProfile,
  loadProfileRegistries,
  loadProjectConfig,
  registryRecordsToExtraction,
  validateExtraction,
  validateProfileExtraction,
  type Extraction,
  type NormalizedOntologyProfile,
  type NormalizedProjectConfig,
  type RegistryRecord,
  type TextJsonGenerationClient,
} from "@sentropic/graphify";

import {
  containsNormalizedPdfExcerpt,
  type RefreshCorpusChunk,
} from "./refresh-corpus.js";

export interface RefreshProfileContext {
  readonly profile: NormalizedOntologyProfile;
  readonly projectConfig?: NormalizedProjectConfig;
  readonly registries: Record<string, RegistryRecord[]>;
  readonly registryExtraction: Extraction;
}
export interface LoadRefreshProfileContextOptions {
  readonly root: string;
  readonly configPath?: string;
  readonly profilePath?: string;
  readonly unregisteredOnly?: boolean;
}
export interface ExtractRefreshProfileOptions {
  readonly textClient: TextJsonGenerationClient;
  readonly context: RefreshProfileContext;
  readonly maxOutputTokens: number;
  readonly outputDir?: string;
}
export interface RefreshProfileChunk {
  readonly chunk: RefreshCorpusChunk;
  readonly extraction: Extraction;
}
export const REFRESH_PROFILE_CONTRACT_VERSION = "immo-pv-extraction-v5";
export function loadRefreshProfileContext(options: LoadRefreshProfileContextOptions): RefreshProfileContext {
  if (options.unregisteredOnly) {
    if (!options.profilePath) throw new Error("Unregistered-only refresh requires an explicit profile path");
    const profile = loadOntologyProfile(options.profilePath);
    const registries: Record<string, RegistryRecord[]> = {};
    return { profile, registries, registryExtraction: registryRecordsToExtraction(registries, profile) };
  }
  const configPath = options.configPath ?? discoverProjectConfig(options.root).path;
  if (!configPath) throw new Error(`No Graphify project config found under ${resolve(options.root)}`);
  const projectConfig = loadProjectConfig(configPath);
  const profile = loadOntologyProfile(options.profilePath ?? projectConfig.profile.resolvedPath, { projectConfig });
  const registries = loadProfileRegistries(profile);
  return { profile, projectConfig, registries,
    registryExtraction: registryRecordsToExtraction(registries, profile) };
}
function allowedNodeTypes(context: RefreshProfileContext): string[] {
  return Object.entries(context.profile.node_types).filter(([, spec]) => {
    const registry = (spec as unknown as { registry?: string }).registry;
    return !registry || registry in context.registries;
  }).map(([type]) => type);
}
function pdfIdentityFor(chunk: RefreshCorpusChunk): Record<string, string> {
  return { source_file: chunk.originalKey, rawRef: chunk.originalKey,
    docSha: chunk.docSha, sourceUrl: chunk.sourceUrl, modality: "pdf" };
}
function schemaFor(chunk: RefreshCorpusChunk, context: RefreshProfileContext): string {
  const allowed = new Set(allowedNodeTypes(context));
  const properties = Object.fromEntries(Object.entries(context.profile.node_types)
    .filter(([type]) => allowed.has(type)).map(([type, spec]) =>
      [type, (spec as unknown as Record<string, unknown>).properties ?? {}]));
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
  const citation = { type: "object", required: ["page", "excerpt"],
    properties: { page: { enum: chunk.pages }, excerpt: { type: "string", minLength: 1,
      maxLength: 200, description: "short verbatim text from the cited page" } },
    description: "The profile injects the constant PDF identity before validation." };
  return JSON.stringify({
    contract_version: REFRESH_PROFILE_CONTRACT_VERSION,
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
        required_for_relation_types: context.profile.evidence_policy.relation_types },
      entity_citations: { node_field: "nodes[].citations", edge_field: "edges[].citations",
        required_for: ["every node", "every edge"], type: "array", minItems: 1, items: citation,
        description: "Emit only page and excerpt; the profile injects the constant PDF identity." },
    },
    evidence: { pdf_identity: pdfIdentity, allowedPages: chunk.pages,
      citation,
      evidence_item: { type: "object",
        required: ["id", "source_file", "rawRef", "docSha", "sourceUrl", "modality", "page", "excerpt"],
        properties: { id: { type: "string", minLength: 1 }, ...pdfIdentityProperties,
          page: { enum: chunk.pages },
          excerpt: { type: "string", minLength: 1, description: "verbatim text from the cited page" } } } },
    constraints: ["Omit facts absent from the chunk, including in-force status and residential unit counts.",
      "An empty nodes/edges/evidence extraction is valid; the enclosing chunk retains the verified PDF identity."],
  });
}
function injectCitationIdentity(value: unknown, chunk: RefreshCorpusChunk): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const root = value as Record<string, unknown>;
  const identity = pdfIdentityFor(chunk);
  for (const collection of [root["nodes"], root["edges"]]) {
    if (!Array.isArray(collection)) continue;
    for (const entity of collection) {
      if (!entity || typeof entity !== "object" || Array.isArray(entity)) continue;
      const record = entity as Record<string, unknown>;
      if (!Array.isArray(record["citations"])) continue;
      record["citations"] = record["citations"].map((citation) =>
        citation && typeof citation === "object" && !Array.isArray(citation)
          ? { ...(citation as Record<string, unknown>), ...identity } : citation);
    }
  }
  return value;
}
function physicalPageTexts(chunk: RefreshCorpusChunk): ReadonlyMap<number, string> {
  const markers = [...chunk.text.matchAll(/^\[PDF PAGE ([1-9]\d*)\]\n/gm)];
  const actualPages = markers.map((marker) => Number(marker[1]));
  if (markers[0]?.index !== 0 || new Set(chunk.pages).size !== chunk.pages.length
    || actualPages.length !== chunk.pages.length
    || actualPages.some((page, index) => page !== chunk.pages[index])) {
    throw new Error(`Invalid physical PDF page markers for chunk ${chunk.id}`);
  }
  return new Map(markers.map((marker, index) => {
    const start = (marker.index ?? 0) + marker[0].length;
    return [actualPages[index]!, chunk.text.slice(start, markers[index + 1]?.index ?? chunk.text.length)];
  }));
}
function validatePdfRecord(value: Record<string, unknown>, chunk: RefreshCorpusChunk,
  pageTexts: ReadonlyMap<number, string>): void {
  if (value["source_file"] !== chunk.originalKey || value["rawRef"] !== chunk.originalKey
    || value["docSha"] !== chunk.docSha || value["sourceUrl"] !== chunk.sourceUrl
    || value["modality"] !== "pdf") {
    throw new Error(`Model output has invalid original PDF identity for chunk ${chunk.id}`);
  }
  const page = value["page"];
  if (!Number.isInteger(page) || !chunk.pages.includes(page as number)) {
    throw new Error(`Model output has invalid original PDF page for chunk ${chunk.id}`);
  }
  const excerpt = value["excerpt"];
  if (typeof excerpt !== "string"
    || !containsNormalizedPdfExcerpt(pageTexts.get(page as number) ?? "", excerpt)) {
    throw new Error(`Model output has ungrounded PDF excerpt for chunk ${chunk.id}`);
  }
}
function validateProvenance(extraction: Extraction, chunk: RefreshCorpusChunk,
  pageTexts: ReadonlyMap<number, string>): void {
  const entities = [...extraction.nodes, ...extraction.edges];
  if (extraction.nodes.some((node) => !node.node_type)) throw new Error(`Untyped node for chunk ${chunk.id}`);
  for (const entity of [...entities, ...(extraction.hyperedges ?? [])]) {
    if (entity.source_file !== chunk.originalKey) throw new Error(`Invalid source_file for chunk ${chunk.id}`);
  }
  for (const entity of entities) {
    for (const citation of entity.citations ?? []) {
      validatePdfRecord(citation as unknown as Record<string, unknown>, chunk, pageTexts);
    }
  }
  for (const evidence of extraction.evidence ?? []) {
    validatePdfRecord(evidence as unknown as Record<string, unknown>, chunk, pageTexts);
  }
}

function strictJsonCandidate(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
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
  return trimmed.slice(firstLineEnd + 1, closingLineStart).trim();
}

function validatedExtraction(text: string, chunk: RefreshCorpusChunk, context: RefreshProfileContext,
  pageTexts: ReadonlyMap<number, string>): Extraction {
  let parsed: unknown;
  try {
    parsed = injectCitationIdentity(JSON.parse(strictJsonCandidate(text)), chunk);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON for chunk ${chunk.id}: ${error.message}`, { cause: error });
    }
    throw error;
  }
  const baseErrors = validateExtraction(parsed);
  if (baseErrors.length > 0) throw new Error(`Invalid Graphify extraction for chunk ${chunk.id}: ${baseErrors.join("; ")}`);
  for (const node of (parsed as Extraction).nodes) {
    const registryId = Object.entries(context.profile.registries)
      .find(([, spec]) => spec.node_type === node.node_type)?.[0];
    if (registryId && !(registryId in context.registries)) {
      throw new Error(`Registry-backed ${node.node_type} requires loaded registry ${registryId}`);
    }
  }
  const profileResult = validateProfileExtraction(parsed, {
    profile: context.profile, registryExtraction: context.registryExtraction,
  });
  if (!profileResult.valid) throw new Error(`Invalid profile extraction for chunk ${chunk.id}: ${profileResult.issues
    .filter((issue) => issue.severity === "error").map((issue) => issue.code).join(", ")}`);
  validateProvenance(parsed as Extraction, chunk, pageTexts);
  return parsed as Extraction;
}
export async function extractRefreshProfile(
  chunks: readonly RefreshCorpusChunk[], options: ExtractRefreshProfileOptions,
): Promise<readonly RefreshProfileChunk[]> {
  if (chunks.length === 0) throw new Error("At least one refresh chunk is required");
  if (!Number.isInteger(options.maxOutputTokens) || options.maxOutputTokens < 1) {
    throw new Error("A positive integer output-token cap is required");
  }
  const prepared = chunks.map((chunk) => {
    if (!/^[a-zA-Z0-9._-]+$/.test(chunk.id) || !chunk.text.trim()) throw new Error(`Invalid required chunk ${chunk.id}`);
    return { chunk, pageTexts: physicalPageTexts(chunk) };
  });
  const temporary = !options.outputDir;
  const outputDir = options.outputDir ?? await mkdtemp(join(tmpdir(), "radar-refresh-profile-"));
  await mkdir(outputDir, { recursive: true });
  const results: RefreshProfileChunk[] = [];
  try {
    for (const { chunk, pageTexts } of prepared) {
      let accepted: Extraction | undefined;
      const outputPath = join(outputDir, `${chunk.id}.json`);
      const generation = await options.textClient.generateJson({
        schema: schemaFor(chunk, options.context),
        prompt: `Contract ${REFRESH_PROFILE_CONTRACT_VERSION}. Emit only these node types: ${allowedNodeTypes(options.context).join(", ")}.
Every node file_type must be "document" for this PDF. Edge confidence, when present, must be
"AMBIGUOUS", "EXTRACTED", or "INFERRED"; never emit a numeric confidence.
Every entity must use the exact PDF identity in the schema. Evidence refs are
non-empty arrays of string IDs from evidence[].id, never embedded objects. Evidence refs do not replace citations.
Every node and every edge must include a non-empty citations array. Each citation must contain only page
and excerpt (at most 200 characters). Do not repeat the document identity inside citations; the profile
injects it before validation. Follow the relation source/target signatures exactly. Every excerpt must be
non-empty verbatim text on its claimed physical PDF page.
If no supported fact is grounded in the PDF, return empty nodes, edges, and evidence.\n\n${buildProfileChunkPrompt(options.context, {
          filePath: chunk.originalKey, fileType: "document", text: chunk.text,
        })}`,
        outputPath, maxOutputTokens: options.maxOutputTokens,
        validateResponse(text) { accepted = validatedExtraction(text, chunk, options.context, pageTexts); },
      });
      if (generation.status !== "completed" || generation.outputPath !== outputPath || !accepted) {
        throw new Error(`Required chunk ${chunk.id} was not completed`);
      }
      const persisted = validatedExtraction(await readFile(outputPath, "utf8"), chunk, options.context, pageTexts);
      results.push({ chunk, extraction: persisted });
    }
    return results;
  } finally {
    if (temporary) await rm(outputDir, { recursive: true, force: true });
  }
}
