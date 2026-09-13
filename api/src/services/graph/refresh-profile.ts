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
  return JSON.stringify({
    type: "Graphify Extraction",
    required: ["nodes", "edges", "input_tokens", "output_tokens"],
    ontology: { profile_id: context.profile.id, profile_version: context.profile.version,
      allowed_node_types: [...allowed], node_properties: properties },
    graph_contract: {
      node_file_type: ["code", "concept", "document", "image", "paper", "rationale"],
      edge_confidence: ["AMBIGUOUS", "EXTRACTED", "INFERRED"],
    },
    evidence: { modality: "pdf", docSha: chunk.docSha, rawRef: chunk.originalKey,
      sourceUrl: chunk.sourceUrl, allowedPages: chunk.pages, excerpt: "verbatim text from the cited page" },
    constraints: ["Omit facts absent from the chunk, including in-force status and residential unit counts."],
  });
}
function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
function validateProvenance(extraction: Extraction, chunk: RefreshCorpusChunk): void {
  const entities = [...extraction.nodes, ...extraction.edges];
  if (extraction.nodes.some((node) => !node.node_type)) throw new Error(`Untyped node for chunk ${chunk.id}`);
  for (const entity of [...entities, ...(extraction.hyperedges ?? [])]) {
    if (entity.source_file !== chunk.originalKey) throw new Error(`Invalid source_file for chunk ${chunk.id}`);
  }
  for (const entity of entities) {
    for (const citation of entity.citations ?? []) {
      const page = citation.page;
      const sourceUrl = citation.sourceUrl ?? citation.source_url;
      const excerpt = citation.excerpt ?? citation.quote;
      if (citation.source_file !== chunk.originalKey || citation.rawRef !== chunk.originalKey
        || citation.docSha !== chunk.docSha || sourceUrl !== chunk.sourceUrl) {
        throw new Error(`Invalid original PDF identity for chunk ${chunk.id}`);
      }
      if (!Number.isInteger(page) || !chunk.pages.includes(page as number)) {
        throw new Error(`Invalid original PDF page for chunk ${chunk.id}`);
      }
      if (!excerpt || !normalized(chunk.text).includes(normalized(excerpt))) {
        throw new Error(`Ungrounded PDF excerpt for chunk ${chunk.id}`);
      }
    }
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
        prompt: `Emit only these node types: ${allowedNodeTypes(options.context).join(", ")}.
Every node file_type must be "document" for this PDF. Edge confidence, when present, must be
"AMBIGUOUS", "EXTRACTED", or "INFERRED"; never emit a numeric confidence.\n\n${buildProfileChunkPrompt(options.context, {
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
