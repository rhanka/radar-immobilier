import { createHash } from "node:crypto";

import type { Extraction, TextJsonGenerationInput } from "@sentropic/graphify";
import { describe, expect, it, vi } from "vitest";

import { createRefreshModelPolicy, type RefreshModel, type RefreshModelReceipt } from "./refresh-model-policy.js";
import type { RefreshProfileChunk } from "./refresh-profile.js";
import { REFRESH_VERIFICATION_PROMPT } from "./refresh-verification-prompt.js";

const primary: RefreshModel = { provider: "openai", model: "gpt-6-astra", effort: "medium" };
const gemini: RefreshModel = { provider: "gemini", model: "gemini-3.8-flash", effort: "low" };
const excerpt = "Le conseil adopte le règlement de zonage.";
const node = (id: string, node_type: string): Extraction["nodes"][number] => ({
  id, node_type, label: id, file_type: "document", source_file: "pv.pdf", etape: "adoption",
  citations: [{ page: 1, excerpt, source_file: "pv.pdf" }],
});
const edge = (source: string, target: string, relation = "raises_signal"): Extraction["edges"][number] => ({
  source, target, relation, source_file: "pv.pdf", confidence: "EXTRACTED",
});
function fixture(): RefreshProfileChunk {
  return { chunk: { id: "chunk-1", docSha: "a".repeat(64), originalKey: "pv.pdf", sourceUrl: "https://city.test/pv.pdf",
    pages: [1], text: `[PDF PAGE 1]\n${excerpt}` }, extraction: {
    nodes: [node("signal", "Signal"), node("bylaw", "Bylaw"), node("event", "DesignationEvent"),
      node("other", "Signal"), node("source", "Source"), node("zone", "Zone"), node("constraint", "Constraint")],
    edges: [edge("signal", "bylaw"), edge("event", "bylaw"), edge("event", "signal"),
      edge("source", "signal"), edge("source", "other"), edge("signal", "other", "supports")],
    input_tokens: 10, output_tokens: 20, evidence: [],
  } };
}
function setup(answer: string | ((request: TextJsonGenerationInput, signal: AbortSignal) => Promise<string>),
  options: { enabled?: boolean; forceFallback?: boolean; failPrimary?: boolean;
    invalidResult?: "identity" | "status" | "missing-text" } = {}) {
  const receipts: RefreshModelReceipt[] = [];
  const calls: RefreshModel[] = [];
  const requests: TextJsonGenerationInput[] = [];
  const record = async (receipt: RefreshModelReceipt) => { receipts.push(receipt); };
  const policy = createRefreshModelPolicy({ primary, fallback: gemini,
    ...(options.enabled !== false ? { verification: gemini } : {}),
    forceFallback: options.forceFallback ?? false, primaryQualityAttempts: 2, timeoutMs: 50,
    createClient(model, signal) {
      return { mode: "mesh", provider: model.provider, model: model.model, async generateJson(request) {
        calls.push(model); requests.push(request);
        if (model === primary && options.failPrimary) throw Object.assign(new Error("quota"), { status: 429 });
        const verify = request.prompt.startsWith(REFRESH_VERIFICATION_PROMPT);
        const text = verify ? typeof answer === "string" ? answer : await answer(request, signal) : "{}";
        if (!verify || options.invalidResult !== "missing-text") await request.validateResponse?.(text);
        return { status: verify && options.invalidResult === "status" ? "instructions_written" : "completed",
          mode: "mesh", provider: model.provider,
          model: verify && options.invalidResult === "identity" ? "unexpected-model" : model.model, audit: {} };
      } };
    },
  });
  const run = async (input = fixture()) => {
    await policy.forDocument(input.chunk.docSha, record).generateJson({ prompt: "extract", schema: "{}" });
    return policy.verify!(input, 512, record);
  };
  return { policy, run, calls, requests, receipts, record };
}
const answer = (decisions: unknown[]) => JSON.stringify({ decisions });
const remove = (act = "A01") => ({ act, verdict: "non_soutenu", reason: "Historical reference only", excerpt: "" });

describe("refresh precision verification", () => {
  it("should preserve the frozen v101b instruction byte for byte", () => {
    expect(createHash("sha256").update(REFRESH_VERIFICATION_PROMPT).digest("hex"))
      .toBe("cf015e57c6e1cd1404efc7e22ddb014da0e4851aba9befea9ef39cae46094b68");
  });

  it("should only remove existing acts and count unknown IDs without accepting graph edits (invariant 1)", async () => {
    const input = fixture();
    const before = structuredClone(input);
    const run = setup(JSON.stringify({ decisions: [remove(), remove("unknown")],
      nodes: [node("invented", "Signal")], edges: [], input_tokens: 999 }));
    const output = await run.run(input);
    expect(output.extraction.nodes).toEqual(input.extraction.nodes.slice(3));
    expect(output.extraction.nodes[0]).toBe(input.extraction.nodes[3]);
    expect(input).toEqual(before);
    expect(output.extraction.input_tokens).toBe(10);
    expect(run.receipts.at(-1)?.verification).toMatchObject({ removed: 1, unknown_ids: 1 });
  });

  it.each([[], [{ act: "A01", verdict: "non_soutenu" }],
    [{ ...remove(), reason: " \n " }], [{ ...remove(), reason: 3 }],
    [{ ...remove(), verdict: "maybe" }], [{ ...remove(), verdict: ["non_soutenu"] }],
    [null]].map((decisions) => ({ decisions })))(
    "should keep acts without an explicit valid decision (invariant 2): %j", async ({ decisions }) => {
      const input = fixture();
      const run = setup(answer(decisions));
      expect(await run.run(input)).toBe(input);
      expect(run.receipts.at(-1)?.verification).toMatchObject({ kept_no_valid_decision: 2, removed: 0 });
    });

  it("should keep a supported act with a non-verbatim excerpt and count it (invariant 3)", async () => {
    const input = fixture();
    const run = setup(answer([{ act: "A01", verdict: "soutenu", reason: "Adoption", excerpt: excerpt.toUpperCase() },
      { act: "A02", verdict: "soutenu", reason: "Adoption", excerpt }]));
    expect(await run.run(input)).toBe(input);
    expect(run.receipts.at(-1)?.verification).toMatchObject({ supported_ungrounded: 1, kept_no_valid_decision: 0 });
  });

  it.each(["not JSON", "```json\n{}\n```", '{"decisions":', "transport"])(
    "should preserve the whole accepted output when verification fails (invariant 4): %s", async (failure) => {
      const input = fixture();
      const run = setup(failure === "transport" ? async () => { throw new Error("network failed"); } : failure);
      expect(await run.run(input)).toBe(input);
      expect(run.calls).toEqual([primary, gemini]);
      expect(run.receipts.at(-1)).toMatchObject({ transition: "verification", status: "failed",
        verification: { status: "failed" } });
    });

  it("should remove incident edges without leaving references to absent nodes (invariant 5)", async () => {
    const input = fixture();
    const run = setup(answer([remove()]));
    const output = await run.run(input);
    expect(output.extraction.nodes.map(({ id }) => id)).toEqual(["other", "source", "zone", "constraint"]);
    expect(output.extraction.edges).toEqual([input.extraction.edges[4]]);
    expect(output.extraction.edges[0]).toBe(input.extraction.edges[4]);
    const remaining = new Set(output.extraction.nodes.map(({ id }) => id));
    expect(output.extraction.edges.every(({ source, target }) => remaining.has(source) && remaining.has(target))).toBe(true);
    expect(output.extraction.evidence).toBe(input.extraction.evidence);
    const prompt = run.requests[1]!.prompt;
    expect(prompt).toContain('"act":"A01"');
    expect(prompt).toContain('"act":"A02"');
    expect(prompt).not.toContain('"act":"A03"');
    expect(prompt).toContain(input.chunk.text);
  });

  it("should use only the first valid decision for a duplicate act", async () => {
    const input = fixture();
    const run = setup(answer([{ act: "A01", verdict: "soutenu", reason: "Adoption", excerpt }, remove()]));
    expect(await run.run(input)).toBe(input);
  });

  it.each(["identity", "status", "missing-text"] as const)(
    "should retain primary output on an invalid verification result: %s", async (invalidResult) => {
      const input = fixture();
      const run = setup(answer([remove()]), { invalidResult });
      expect(await run.run(input)).toBe(input);
      expect(run.receipts.at(-1)).toMatchObject({ status: "failed", transition: "verification",
        modelUsed: invalidResult === "identity" ? null : gemini });
    });

  it("should never verify the fallback after persistent primary quality refusal", async () => {
    const run = setup(answer([remove()]));
    let validations = 0;
    const input = fixture();
    await run.policy.forDocument(input.chunk.docSha, run.record).generateJson({ prompt: "extract", schema: "{}",
      validateResponse() { if (++validations <= 2) throw new Error("Invalid profile extraction"); } });
    expect(await run.policy.verify!(input, 512, run.record)).toBe(input);
    expect(run.calls).toEqual([primary, primary, gemini]);
    expect(run.receipts.at(-1)).toMatchObject({ fallbackReason: "quality", verification: { status: "skipped-fallback" } });
  });

  it("should not let verifier quota errors open the primary extraction circuit", async () => {
    const run = setup(async () => { throw Object.assign(new Error("quota"), { status: 429 }); });
    for (const digit of ["a", "b", "c", "d"]) {
      const input = fixture();
      await run.run({ ...input, chunk: { ...input.chunk, docSha: digit.repeat(64) } });
    }
    expect(run.calls).toEqual([primary, gemini, primary, gemini, primary, gemini, primary, gemini]);
    expect(run.receipts.filter(({ transition }) => transition === "fallback")).toEqual([]);
  });

  it("should propagate durable receipt failures instead of marking verification complete", async () => {
    const run = setup(answer([remove()]));
    const input = fixture();
    await run.policy.forDocument(input.chunk.docSha, run.record).generateJson({ prompt: "extract", schema: "{}" });
    await expect(run.policy.verify!(input, 512, async () => { throw new Error("store unavailable"); }))
      .rejects.toThrow("store unavailable");
    expect(run.calls).toEqual([primary, gemini]);
  });

  it.each([{ forceFallback: true }, { failPrimary: true }])(
    "should skip verification on Gemini fallback and log the skip: %j", async (options) => {
      const input = fixture();
      const run = setup(answer([remove()]), options);
      expect(await run.run(input)).toBe(input);
      expect(run.calls.filter((model) => model === gemini)).toHaveLength(1);
      expect(run.receipts.at(-1)).toMatchObject({ transition: "fallback", verification: { status: "skipped-fallback" } });
    });

  it("should disable verification and partition durable state by policy", async () => {
    const input = fixture();
    const run = setup(answer([remove()]), { enabled: false });
    expect(await run.run(input)).toBe(input);
    expect(run.calls).toEqual([primary]);
    expect(run.receipts[0]?.verification?.status).toBe("disabled");
    expect(run.policy.maximumAttempts).toBe(3);
    const enabled = setup("{}");
    expect(enabled.policy.maximumAttempts).toBe(4);
    expect(enabled.policy.policy).not.toBe(run.policy.policy);
  });

  it("should verify every accepted primary chunk and ignore verifier failures when restoring affinity", async () => {
    const run = setup("bad JSON");
    await run.run();
    const resumed = setup(answer([]));
    resumed.policy.restoreDocument(fixture().chunk.docSha, run.receipts);
    await resumed.run();
    await resumed.run();
    expect(resumed.calls).toEqual([primary, gemini, primary, gemini]);
    expect(resumed.receipts.map(({ attempt }) => attempt)).toEqual([3, 4, 5, 6]);
  });

  it("should keep primary after a verification deadline even if transport finishes late", async () => {
    vi.useFakeTimers();
    try {
      let finish: (text: string) => void = () => {};
      const run = setup(async () => new Promise<string>((resolve) => { finish = resolve; }));
      const input = fixture();
      const pending = run.run(input);
      await vi.advanceTimersByTimeAsync(50);
      expect(await pending).toBe(input);
      finish(answer([remove()]));
      await vi.advanceTimersByTimeAsync(1);
      expect(run.receipts.at(-1)).toMatchObject({ failureReason: "timeout" });
      expect(input.extraction.nodes).toHaveLength(7);
    } finally { vi.useRealTimers(); }
  });
});
