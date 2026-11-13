import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { Extraction } from "@sentropic/engram";

export interface SinglePassPrompt { readonly id: string; readonly sha256: string; readonly text: string }
const classes = ["pertinent", "a_surveiller", "non_classe", "ecarte"] as const;
const classSchema = z.object({ classe: z.enum(classes), reason: z.string().trim().min(1).max(1000),
  reasonCode: z.string().regex(/^(?:[PSN]-[A-Z-]+|V2-PRECEDENT|UNCLASSIFIED)$/) });
export type SinglePassClass = z.infer<typeof classSchema>;
export interface SinglePassAnnotation extends SinglePassClass { readonly nodeId: string }

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
