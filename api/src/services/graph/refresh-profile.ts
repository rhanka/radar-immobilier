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

import type { RefreshCorpusChunk } from "./refresh-corpus.js";

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
export const REFRESH_PROFILE_CONTRACT_VERSION = "refresh-pv-018.2";
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
  const pdfIdentity = { source_file: chunk.originalKey, rawRef: chunk.originalKey,
    docSha: chunk.docSha, sourceUrl: chunk.sourceUrl, modality: "pdf" };
  const pdfIdentityProperties = Object.fromEntries(Object.entries(pdfIdentity)
    .map(([key, value]) => [key, { const: value }]));
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
    },
    evidence: { pdf_identity: pdfIdentity, allowedPages: chunk.pages,
      citation: { type: "object", required: ["source_file", "rawRef", "docSha", "sourceUrl", "page", "excerpt"],
        properties: { ...pdfIdentityProperties, page: { enum: chunk.pages },
          excerpt: { type: "string", description: "verbatim text from the cited page" } } },
      evidence_item: { type: "object", required: ["id", "source_file", "rawRef", "docSha", "sourceUrl", "page", "excerpt"],
        properties: { id: { type: "string", minLength: 1 }, ...pdfIdentityProperties,
          page: { enum: chunk.pages },
          excerpt: { type: "string", description: "verbatim text from the cited page" } } } },
    constraints: ["Omit facts absent from the chunk, including in-force status and residential unit counts.",
      "An empty nodes/edges/evidence extraction is valid; the enclosing chunk retains the verified PDF identity."],
  });
}
function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
function validatePdfRecord(value: Record<string, unknown>, chunk: RefreshCorpusChunk): void {
  if (value["source_file"] !== chunk.originalKey || value["rawRef"] !== chunk.originalKey
    || value["docSha"] !== chunk.docSha || value["sourceUrl"] !== chunk.sourceUrl
    || value["modality"] !== "pdf") {
    throw new Error(`Model output has invalid original PDF identity for chunk ${chunk.id}`);
  }
  const page = value["page"];
  if (!Number.isInteger(page) || !chunk.pages.includes(page as number)) {
    throw new Error(`Model output has invalid original PDF page for chunk ${chunk.id}`);
  }
  const excerpt = value["excerpt"] ?? value["quote"] ?? value["text"];
  if (typeof excerpt !== "string" || !normalized(chunk.text).includes(normalized(excerpt))) {
    throw new Error(`Model output has ungrounded PDF excerpt for chunk ${chunk.id}`);
  }
}
function validateProvenance(extraction: Extraction, chunk: RefreshCorpusChunk): void {
  const entities = [...extraction.nodes, ...extraction.edges];
  if (extraction.nodes.some((node) => !node.node_type)) throw new Error(`Untyped node for chunk ${chunk.id}`);
  for (const entity of [...entities, ...(extraction.hyperedges ?? [])]) {
    if (entity.source_file !== chunk.originalKey) throw new Error(`Invalid source_file for chunk ${chunk.id}`);
  }
  for (const entity of entities) {
    for (const citation of entity.citations ?? []) {
      validatePdfRecord(citation as unknown as Record<string, unknown>, chunk);
    }
  }
  for (const evidence of extraction.evidence ?? []) {
    validatePdfRecord(evidence as unknown as Record<string, unknown>, chunk);
  }
}

function validatedExtraction(text: string, chunk: RefreshCorpusChunk, context: RefreshProfileContext): Extraction {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error(`Invalid JSON for chunk ${chunk.id}`); }
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
  validateProvenance(parsed as Extraction, chunk);
  return parsed as Extraction;
}
export async function extractRefreshProfile(
  chunks: readonly RefreshCorpusChunk[], options: ExtractRefreshProfileOptions,
): Promise<readonly RefreshProfileChunk[]> {
  if (chunks.length === 0) throw new Error("At least one refresh chunk is required");
  if (!Number.isInteger(options.maxOutputTokens) || options.maxOutputTokens < 1) {
    throw new Error("A positive integer output-token cap is required");
  }
  const temporary = !options.outputDir;
  const outputDir = options.outputDir ?? await mkdtemp(join(tmpdir(), "radar-refresh-profile-"));
  await mkdir(outputDir, { recursive: true });
  const results: RefreshProfileChunk[] = [];
  try {
    for (const chunk of chunks) {
      if (!/^[a-zA-Z0-9._-]+$/.test(chunk.id) || !chunk.text.trim()) throw new Error(`Invalid required chunk ${chunk.id}`);
      let accepted: Extraction | undefined;
      const outputPath = join(outputDir, `${chunk.id}.json`);
      const generation = await options.textClient.generateJson({
        schema: schemaFor(chunk, options.context),
        prompt: `Contract ${REFRESH_PROFILE_CONTRACT_VERSION}. Emit only these node types: ${allowedNodeTypes(options.context).join(", ")}.
Every node file_type must be "document" for this PDF. Edge confidence, when present, must be
"AMBIGUOUS", "EXTRACTED", or "INFERRED"; never emit a numeric confidence.
Every entity and nested citation must use the exact PDF identity in the schema. Evidence refs are
non-empty arrays of string IDs from evidence[].id, never embedded objects. Follow the relation source/target
signatures exactly. If no supported fact is grounded in the PDF, return empty nodes, edges, and evidence.\n\n${buildProfileChunkPrompt(options.context, {
          filePath: chunk.originalKey, fileType: "document", text: chunk.text,
        })}`,
        outputPath, maxOutputTokens: options.maxOutputTokens,
        validateResponse(text) { accepted = validatedExtraction(text, chunk, options.context); },
      });
      if (generation.status !== "completed" || generation.outputPath !== outputPath || !accepted) {
        throw new Error(`Required chunk ${chunk.id} was not completed`);
      }
      const persisted = validatedExtraction(await readFile(outputPath, "utf8"), chunk, options.context);
      results.push({ chunk, extraction: persisted });
    }
    return results;
  } finally {
    if (temporary) await rm(outputDir, { recursive: true, force: true });
  }
}
