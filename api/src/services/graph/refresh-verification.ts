import type { Extraction, TextJsonGenerationClient } from "@sentropic/graphify";

import { normalizePdfExcerpt, type RefreshCorpusChunk } from "./refresh-corpus.js";
import type { RefreshModel } from "./refresh-model-policy.js";
import type { RefreshProfileChunk } from "./refresh-profile.js";
import { REFRESH_VERIFICATION_PROMPT } from "./refresh-verification-prompt.js";

export interface RefreshVerificationSummary {
  readonly status: "completed" | "failed" | "skipped-fallback" | "skipped-no-acts" | "disabled";
  readonly acts?: number;
  readonly removed?: number;
  readonly unknown_ids?: number;
  readonly kept_no_valid_decision?: number;
  readonly supported_ungrounded?: number;
  readonly contradicting_excerpt_ungrounded?: number;
}

/** Benchmark floor: an anchor shorter than this no longer proves the passage was read. */
const MIN_VERIFICATION_EXCERPT_CODE_POINTS = 20;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/**
 * Benchmark `parseJsonObject()`: tolerate a fenced block and prose around a single JSON object,
 * and refuse anything that is not an object. A scalar, null or array answer is a parse failure,
 * not an empty decision list, so it can never be mistaken for "the verifier judged nothing".
 */
export function parseRefreshVerificationJson(text: string): Record<string, unknown> {
  const trimmed = String(text ?? "").trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  let body = fenced?.[1] ?? trimmed;
  let parsed: unknown;
  try { parsed = JSON.parse(body); }
  catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start < 0 || end <= start) throw new SyntaxError("No JSON object in refresh verification output");
    body = body.slice(start, end + 1);
    parsed = JSON.parse(body);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("Refresh verification output is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/**
 * Physical pages of the chunk, rebuilt from the `[PDF PAGE n]` markers the corpus writes
 * (refresh-corpus.ts). Grounding is per physical page, as in the benchmark; consecutive segments
 * of one page that the byte bound split are rejoined so a page stays one grounding surface.
 */
export function refreshChunkPages(chunk: Pick<RefreshCorpusChunk, "text" | "pages">):
readonly { readonly page: number; readonly text: string }[] {
  const parts = chunk.text.split(/^\[PDF PAGE (\d+)\]\n/mu);
  const segments: { page: number; text: string }[] = [];
  for (let index = 1; index < parts.length; index += 2) {
    segments.push({ page: Number(parts[index]), text: parts[index + 1] ?? "" });
  }
  const pages: { page: number; text: string }[] = [];
  segments.forEach((segment, index) => {
    // The corpus joins parts with a blank line; drop that separator so a page block carries the
    // page text and nothing else, exactly like the benchmark's pagesBlock.
    const text = index < segments.length - 1 && segment.text.endsWith("\n\n")
      ? segment.text.slice(0, -2) : segment.text;
    const previous = pages.at(-1);
    if (previous?.page === segment.page) previous.text += text;
    else pages.push({ page: segment.page, text });
  });
  return pages.length ? pages : [{ page: chunk.pages[0] ?? 1, text: chunk.text }];
}

/**
 * Benchmark `grounded()`: at least 20 Unicode code points AND a normalized match inside ONE
 * physical page. A raw substring of the whole chunk is not enough: it accepts a two-character
 * anchor and an excerpt stitched across a page boundary. Grounding only feeds counters here —
 * it never removes an act — so a stricter anchor can lose no signal.
 */
function grounded(pages: readonly { readonly text: string }[], excerpt: unknown): boolean {
  if (typeof excerpt !== "string" || [...excerpt].length < MIN_VERIFICATION_EXCERPT_CODE_POINTS) return false;
  const needle = normalizePdfExcerpt(excerpt);
  return needle !== "" && pages.some((page) => normalizePdfExcerpt(page.text).includes(needle));
}

/** Connected components over eligible nodes only; other relations never merge acts. */
export function refreshVerificationActs(extraction: Extraction) {
  const eligible = extraction.nodes.filter((node) =>
    ["Signal", "DesignationEvent", "Bylaw"].includes(node.node_type ?? ""));
  const parents = new Map(eligible.map((node) => [node.id, node.id]));
  const root = (id: string): string => {
    let current = id;
    while (parents.get(current) !== current) current = parents.get(current)!;
    return current;
  };
  for (const edge of extraction.edges) {
    if (edge.relation === "raises_signal" && parents.has(edge.source) && parents.has(edge.target)) {
      parents.set(root(edge.target), root(edge.source));
    }
  }
  const groups = new Map<string, Extraction["nodes"]>();
  for (const node of eligible) {
    const key = root(node.id);
    groups.set(key, [...(groups.get(key) ?? []), node]);
  }
  const evidence = new Map(extraction.evidence?.map((item) => [item.id, item]));
  return [...groups.values()].map((nodes, index) => ({
    act: `A${String(index + 1).padStart(2, "0")}`, nodes,
    view: nodes.map((node) => {
      const properties = record(node["properties"] ?? node);
      const citations = [...(node.citations ?? []), ...(node.evidence_refs ?? [])
        .flatMap((id) => evidence.has(id) ? [evidence.get(id)!] : [])];
      return { type: node.node_type, label: node.label ?? null,
        stage: properties["etape"] ?? properties["stage"] ?? properties["stade"] ?? null,
        objet: properties["numero"] ?? properties["objet"] ?? properties["adresse"] ?? properties["lot"] ?? null,
        citations: citations.map((citation) => ({ page: citation.page, excerpt: citation.excerpt })) };
    }),
  }));
}

/**
 * Benchmark message framing, within the single `prompt` string the text/JSON port accepts:
 * document identity, pretty acts JSON, `=== PAGE n ===` page blocks. The benchmark sends the
 * instruction as a separate system message; the port has no system field, so the instruction
 * stays first in the user prompt (see the status report).
 */
export function refreshVerificationPrompt(input: RefreshProfileChunk,
  acts: readonly { act: string; view: unknown }[], citySlug?: string): string {
  const pages = refreshChunkPages(input.chunk);
  const identity = `Document : ${input.chunk.docSha}`
    + `${citySlug ? ` (ville ${citySlug}, ` : " ("}${pages.length} pages)`;
  return `${REFRESH_VERIFICATION_PROMPT}\n\n${identity}\n\nACTES À VÉRIFIER (${acts.length}) :\n`
    + `${JSON.stringify({ acts: acts.map(({ act, view }) => ({ act, nodes: view })) }, null, 1)}`
    + `\n\nTEXTE DU DOCUMENT :\n${pages.map((page) => `=== PAGE ${page.page} ===\n${page.text}`).join("\n")}`;
}

const EMPTY_SUMMARY = { acts: 0, removed: 0, unknown_ids: 0, kept_no_valid_decision: 0,
  supported_ungrounded: 0, contradicting_excerpt_ungrounded: 0 } as const;

/** No verifier-provided graph content is ever read or copied into the accepted extraction. */
export async function verifyRefreshProfile(input: RefreshProfileChunk, options: {
  model: RefreshModel; client: TextJsonGenerationClient; signal: AbortSignal; maxOutputTokens: number;
  citySlug?: string;
}): Promise<{ output: RefreshProfileChunk; summary: RefreshVerificationSummary }> {
  const acts = refreshVerificationActs(input.extraction);
  // Nothing to judge: the benchmark makes no call either, and a call could only invent an act.
  if (acts.length === 0) return { output: input, summary: { status: "skipped-no-acts", ...EMPTY_SUMMARY } };
  const pages = refreshChunkPages(input.chunk);
  let response: unknown;
  let received = false;
  const result = await options.client.generateJson({
    prompt: refreshVerificationPrompt(input, acts, options.citySlug),
    schema: JSON.stringify({ type: "object", required: ["decisions"], properties: {
      decisions: { type: "array", items: { type: "object", required: ["act", "verdict", "reason", "excerpt"],
        properties: { act: { type: "string" }, verdict: { enum: ["soutenu", "non_soutenu"] },
          reason: { type: "string" }, excerpt: { type: "string" } } } },
    } }), maxOutputTokens: options.maxOutputTokens,
    validateResponse(text) {
      options.signal.throwIfAborted();
      response = parseRefreshVerificationJson(text);
      received = true;
    },
  });
  options.signal.throwIfAborted();
  if (result.provider !== options.model.provider || result.model !== options.model.model) {
    throw Object.assign(new Error("Refresh verification identity mismatch"), { code: "REFRESH_MODEL_MISMATCH" });
  }
  if (!received || result.status !== "completed") throw new Error("Refresh verification result incomplete");
  const decisions = record(response)["decisions"];
  const known = new Map(acts.map((act) => [act.act, act]));
  const seen = new Set<string>();
  const removed = new Set<string>();
  let unknownIds = 0;
  let supportedUngrounded = 0;
  let contradictingExcerptUngrounded = 0;
  for (const value of Array.isArray(decisions) ? decisions : []) {
    // A primitive or null entry is skipped in silence, like the benchmark: it names no act,
    // so counting it as an unknown identifier would overstate the verifier's confusion.
    if (value === null || typeof value !== "object") continue;
    const decision = value as Record<string, unknown>;
    const id = decision["act"];
    if (typeof id !== "string" || !known.has(id)) { unknownIds++; continue; }
    if (seen.has(id)) continue;
    const verdict = decision["verdict"];
    const reason = decision["reason"];
    if (typeof reason !== "string" || !reason.trim() || (verdict !== "soutenu" && verdict !== "non_soutenu")) continue;
    seen.add(id);
    if (verdict === "non_soutenu") {
      if (decision["excerpt"] && !grounded(pages, decision["excerpt"])) contradictingExcerptUngrounded++;
      removed.add(id);
    } else if (!grounded(pages, decision["excerpt"])) supportedUngrounded++;
  }
  const removedNodes = new Set(acts.filter(({ act }) => removed.has(act)).flatMap(({ nodes }) => nodes.map(({ id }) => id)));
  return {
    output: removedNodes.size ? { ...input, extraction: { ...input.extraction,
      nodes: input.extraction.nodes.filter(({ id }) => !removedNodes.has(id)),
      edges: input.extraction.edges.filter(({ source, target }) => !removedNodes.has(source) && !removedNodes.has(target)),
    } } : input,
    summary: { status: "completed", acts: acts.length, removed: removed.size, unknown_ids: unknownIds,
      kept_no_valid_decision: acts.length - seen.size, supported_ungrounded: supportedUngrounded,
      contradicting_excerpt_ungrounded: contradictingExcerptUngrounded },
  };
}
