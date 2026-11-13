import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { Extraction } from "@sentropic/engram";
import { canonicalHash } from "./replay/canonical-json.js";
import type { RefreshModel } from "./refresh-model-policy.js";

/** Dedicated settings keep flag-zero model selection unchanged. */
export function singlePassPrimary(env: NodeJS.ProcessEnv = process.env): RefreshModel {
  const provider = env.REFRESH_SINGLE_PASS_PROVIDER ?? "openai";
  const model = env.REFRESH_SINGLE_PASS_MODEL ?? "gpt-6-astra";
  const effort = env.REFRESH_SINGLE_PASS_REASONING_EFFORT ?? "low";
  if (provider !== "openai" && provider !== "gemini") throw new Error("Invalid single-pass provider");
  if (!model.trim() || !["minimal", "low", "medium", "high", "xhigh"].includes(effort)) {
    throw new Error("Invalid single-pass model or effort");
  }
  return { provider, model, effort };
}

export interface SinglePassPrompt { readonly id: string; readonly sha256: string; readonly text: string }
const classes = ["pertinent", "a_surveiller", "non_classe", "ecarte"] as const;
const classSchema = z.object({ classe: z.enum(classes), reason: z.string().trim().min(1).max(1000),
  reasonCode: z.string().regex(/^(?:[PSN]-[A-Z-]+|V2-PRECEDENT|UNCLASSIFIED)$/) });
export type SinglePassClass = z.infer<typeof classSchema>;
export interface SinglePassAnnotation extends SinglePassClass { readonly nodeId: string }

export function singlePassSchema(nativeSchema: string): string {
  const schema = JSON.parse(nativeSchema) as { required: string[]; annotations?: unknown };
  return JSON.stringify({ ...schema, required: [...schema.required, "annotations"], annotations: {
    type: "array", description: "Exactly one class annotation per Signal or DesignationEvent node", items: {
      type: "object", required: ["nodeId", "classe", "reason", "reasonCode"], properties: {
        nodeId: { type: "string" }, classe: { enum: classes }, reason: { type: "string" }, reasonCode: { type: "string" },
      },
    },
  } });
}

export function singlePassEnabled(value: string | undefined): boolean {
  if (value === undefined || value === "0") return false;
  if (value === "1") return true;
  throw new Error("REFRESH_SINGLE_PASS must be 0 or 1");
}

export async function loadSinglePassPrompt(): Promise<SinglePassPrompt> {
  const path = resolve(process.env.REFRESH_PROMPT_MANIFEST
    ?? (process.cwd().endsWith("/api") ? "../radar/prompts/refresh-single-pass.json" : "radar/prompts/refresh-single-pass.json"));
  const manifest = z.object({ id: z.string().min(1), file: z.string().regex(/^[a-zA-Z0-9_.-]+\.md$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/) }).parse(JSON.parse(await readFile(path, "utf8")));
  const bytes = await readFile(resolve(dirname(path), manifest.file));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== manifest.sha256) throw new Error("Single-pass prompt checksum mismatch");
  return { id: manifest.id, sha256, text: bytes.toString("utf8") };
}

export function parseSinglePassClass(value: unknown): SinglePassClass {
  const result = classSchema.parse(value);
  const expected = result.reasonCode.startsWith("P-") ? "pertinent"
    : result.reasonCode.startsWith("S-") ? "a_surveiller"
      : result.reasonCode === "UNCLASSIFIED" ? "non_classe" : "ecarte";
  if (result.classe !== expected) throw new Error("Single-pass class and reason code disagree");
  return result;
}

/** Removes the extra envelope before passing the graph to the unchanged native validator. */
export function takeSinglePassAnnotations(value: unknown): SinglePassAnnotation[] {
  const root = z.object({ annotations: z.array(z.object({ nodeId: z.string().min(1) }).passthrough()) }).parse(value);
  const annotations = root.annotations.map((item) => ({ nodeId: item.nodeId, ...parseSinglePassClass(item) }));
  delete (value as Record<string, unknown>)["annotations"];
  return annotations;
}

export function validateSinglePassCoverage(extraction: Extraction, annotations: readonly SinglePassAnnotation[]): void {
  const acts = extraction.nodes.filter((node) => node.node_type === "Signal" || node.node_type === "DesignationEvent");
  const ids = new Set(annotations.map((item) => item.nodeId));
  if (ids.size !== annotations.length || annotations.length !== acts.length
    || acts.some((node) => !ids.has(node.id))) throw new Error("Single-pass annotation coverage mismatch");
}

/** Trusted provenance comes from the accepted receipt, never from generated JSON. */
export function attachSinglePassAnnotations(result: { extraction: Extraction; annotations?: readonly SinglePassAnnotation[] },
  options: { model: { model: string; effort: string }; prompt: SinglePassPrompt; pipelineRunId: string }): void {
  validateSinglePassCoverage(result.extraction, result.annotations ?? []);
  for (const annotation of result.annotations ?? []) {
    const node = result.extraction.nodes.find((item) => item.id === annotation.nodeId)!;
    const properties = (node["properties"] ?? {}) as Record<string, unknown>;
    const inputSha256 = canonicalHash(node).slice(7);
    node["properties"] = { ...properties, classAnnotation: {
      ...annotation, source: "ai", model: options.model.model, effort: options.model.effort,
      promptId: options.prompt.id, promptSha256: options.prompt.sha256,
      pipelineRunId: options.pipelineRunId, inputSha256,
    } };
  }
}
