import type { Extraction, TextJsonGenerationClient } from "@sentropic/graphify";

import type { RefreshModel } from "./refresh-model-policy.js";
import type { RefreshProfileChunk } from "./refresh-profile.js";
import { REFRESH_VERIFICATION_PROMPT } from "./refresh-verification-prompt.js";

export interface RefreshVerificationSummary {
  readonly status: "completed" | "failed" | "skipped-fallback" | "disabled";
  readonly acts?: number;
  readonly removed?: number;
  readonly unknown_ids?: number;
  readonly kept_no_valid_decision?: number;
  readonly supported_ungrounded?: number;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** Connected components over eligible nodes only; other relations never merge acts. */
function actsOf(extraction: Extraction) {
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

/** No verifier-provided graph content is ever read or copied into the accepted extraction. */
export async function verifyRefreshProfile(input: RefreshProfileChunk, options: {
  model: RefreshModel; client: TextJsonGenerationClient; signal: AbortSignal; maxOutputTokens: number;
}): Promise<{ output: RefreshProfileChunk; summary: RefreshVerificationSummary }> {
  const acts = actsOf(input.extraction);
  let response: unknown;
  let received = false;
  const result = await options.client.generateJson({
    prompt: `${REFRESH_VERIFICATION_PROMPT}\n\nACTES À VÉRIFIER (${acts.length}) :\n`
      + JSON.stringify({ acts: acts.map(({ act, view }) => ({ act, nodes: view })) })
      + `\n\nTEXTE DU DOCUMENT :\n${input.chunk.text}`,
    schema: JSON.stringify({ type: "object", required: ["decisions"], properties: {
      decisions: { type: "array", items: { type: "object", required: ["act", "verdict", "reason", "excerpt"],
        properties: { act: { type: "string" }, verdict: { enum: ["soutenu", "non_soutenu"] },
          reason: { type: "string" }, excerpt: { type: "string" } } } },
    } }), maxOutputTokens: options.maxOutputTokens,
    validateResponse(text) {
      options.signal.throwIfAborted();
      response = JSON.parse(text);
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
  for (const value of Array.isArray(decisions) ? decisions : []) {
    const decision = record(value);
    const id = decision["act"];
    if (typeof id !== "string" || !known.has(id)) { unknownIds++; continue; }
    if (seen.has(id)) continue;
    const verdict = decision["verdict"];
    const reason = decision["reason"];
    if (typeof reason !== "string" || !reason.trim() || (verdict !== "soutenu" && verdict !== "non_soutenu")) continue;
    seen.add(id);
    if (verdict === "non_soutenu") removed.add(id);
    else {
      const excerpt = decision["excerpt"];
      if (typeof excerpt !== "string" || !excerpt.trim() || !input.chunk.text.includes(excerpt)) supportedUngrounded++;
    }
  }
  const removedNodes = new Set(acts.filter(({ act }) => removed.has(act)).flatMap(({ nodes }) => nodes.map(({ id }) => id)));
  return {
    output: removedNodes.size ? { ...input, extraction: { ...input.extraction,
      nodes: input.extraction.nodes.filter(({ id }) => !removedNodes.has(id)),
      edges: input.extraction.edges.filter(({ source, target }) => !removedNodes.has(source) && !removedNodes.has(target)),
    } } : input,
    summary: { status: "completed", acts: acts.length, removed: removed.size, unknown_ids: unknownIds,
      kept_no_valid_decision: acts.length - seen.size, supported_ungrounded: supportedUngrounded },
  };
}
