import type { TextJsonGenerationClient } from "@sentropic/graphify";
import { describe, expect, it, vi } from "vitest";

import { createRefreshModelPolicy, type RefreshModel, type RefreshModelReceipt } from "./refresh-model-policy.js";

const primary: RefreshModel = { provider: "openai", model: "gpt-6-astra", effort: "low" };
const fallback: RefreshModel = { provider: "gemini", model: "gemini-3.8-flash", effort: "low" };
const input = { prompt: "Extract", schema: "{}", validateResponse: () => {} };
function fixture(generate: (model: RefreshModel, signal: AbortSignal) => Promise<string>, forceFallback = false,
  signal?: AbortSignal) {
  const calls: string[] = [];
  const receipts: RefreshModelReceipt[] = [];
  const policy = createRefreshModelPolicy({ primary, fallback, forceFallback, timeoutMs: 50,
    ...(signal ? { signal } : {}),
    createClient(model, attemptSignal): TextJsonGenerationClient {
      return { mode: "mesh", provider: model.provider, model: model.model, async generateJson(request) {
        calls.push(model.model);
        const text = await generate(model, attemptSignal);
        await request.validateResponse?.(text);
        return { status: "completed", mode: "mesh", provider: model.provider, model: model.model, audit: {} };
      } };
    } });
  const document = (id: string) => policy.forDocument(id, async (receipt) => { receipts.push(receipt); });
  return { policy, document, calls, receipts };
}
describe("refresh model policy", () => {
  it.each([
    [Object.assign(new Error("limited"), { status: 429 }), "quota"],
    [Object.assign(new Error("down"), { statusCode: 503 }), "transport"],
    [Object.assign(new Error("missing"), { code: "no_active_account" }), "quota"],
    [Object.assign(new Error("missing"), { code: "no-route" }), "transport"],
    [new TypeError("fetch failed"), "transport"],
  ])("should fall back on a primary transport failure (%s)", async (error, reason) => {
    const run = fixture(async (model) => { if (model === primary) throw error; return "{}"; });
    await run.document("one").generateJson(input);
    expect(run.calls).toEqual([primary.model, fallback.model]);
    expect(run.receipts).toMatchObject([{ modelUsed: primary, status: "failed", failureReason: reason },
      { modelUsed: fallback, status: "completed", fallbackReason: reason }]);
  });

  it.each(["", " \n\t"])("should fall back on an empty successful stream (%j)", async (text) => {
    const run = fixture(async (model) => model === primary ? text : "{}");
    await run.document("one").generateJson(input);
    expect(run.receipts[1]).toMatchObject({ fallbackReason: "empty-output" });
  });

  it("should give fallback a fresh signal after the primary timeout", async () => {
    vi.useFakeTimers();
    try {
      const run = fixture(async (model, signal) => {
        if (model === fallback) { expect(signal.aborted).toBe(false); return "{}"; }
        return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
      });
      const pending = run.document("one").generateJson(input);
      await vi.advanceTimersByTimeAsync(50);
      await pending;
      expect(run.receipts[1]).toMatchObject({ fallbackReason: "timeout" });
    } finally { vi.useRealTimers(); }
  });

  it.each(["Invalid JSON", "Invalid profile extraction", "ungrounded PDF excerpt"])(
    "should retain quality refusal without fallback (%s)", async (message) => {
      const run = fixture(async () => "bad output");
      await expect(run.document("one").generateJson({ ...input,
        validateResponse() { throw new Error(message); } })).rejects.toThrow(message);
      expect(run.calls).toEqual([primary.model]);
      expect(run.receipts[0]).toMatchObject({ modelUsed: primary, status: "quality-refused" });
    });

  it("should open the quota circuit after three distinct documents, not chunks", async () => {
    const run = fixture(async (model) => {
      if (model === primary) throw Object.assign(new Error("quota"), { status: 429 });
      return "{}";
    });
    for (const id of ["a", "a", "a", "b", "c", "d"]) await run.document(id).generateJson(input);
    expect(run.calls.filter((model) => model === primary.model)).toHaveLength(3);
    expect(run.receipts.at(-1)).toMatchObject({ fallbackReason: "circuit-open" });
  });

  it("should reset consecutive quota failures after a primary success", async () => {
    let primaryCalls = 0;
    const run = fixture(async (model) => {
      if (model === primary && ++primaryCalls !== 3) throw Object.assign(new Error("quota"), { status: 429 });
      return "{}";
    });
    for (const id of ["a", "b", "c", "d", "e", "f", "g"]) {
      await run.document(id).generateJson(input);
      run.policy.completeDocument(id);
    }
    expect(primaryCalls).toBe(6);
    expect(run.receipts.at(-1)?.fallbackReason).toBe("circuit-open");
  });

  it("should force fallback with a distinct durable policy identity", async () => {
    const run = fixture(async () => "{}", true);
    await run.document("one").generateJson(input);
    expect(run.calls).toEqual([fallback.model]);
    expect(run.receipts[0]?.fallbackReason).toBe("forced");
    expect(run.policy.policy).not.toBe(fixture(async () => "{}").policy.policy);
  });

  it("should count quota documents even when their first chunks succeed", async () => {
    let attempts = 0;
    const run = fixture(async (model) => {
      if (model === primary && ++attempts % 2 === 0) throw Object.assign(new Error("quota"), { status: 429 });
      return "{}";
    });
    for (const id of ["a", "b", "c"]) {
      await run.document(id).generateJson(input);
      await run.document(id).generateJson(input);
      run.policy.completeDocument(id);
    }
    await run.document("d").generateJson(input);
    expect(attempts).toBe(6);
    expect(run.receipts.at(-1)?.fallbackReason).toBe("circuit-open");
  });

  it("should propagate cycle cancellation without falling back", async () => {
    const controller = new AbortController();
    const run = fixture(async () => { controller.abort(); throw controller.signal.reason; }, false, controller.signal);
    await expect(run.document("one").generateJson(input)).rejects.toMatchObject({ name: "AbortError" });
    expect(run.calls).toEqual([primary.model]);
  });

  it("should stop after both transports fail", async () => {
    const run = fixture(async () => { throw new Error("network"); });
    await expect(run.document("one").generateJson(input)).rejects.toThrow("network");
    expect(run.calls).toEqual([primary.model, fallback.model]);
  });

  it("should not make another model call when durable receipt persistence fails", async () => {
    const run = fixture(async () => "{}");
    const client = run.policy.forDocument("one", async () => { throw new Error("store unavailable"); });
    await expect(client.generateJson(input)).rejects.toThrow("store unavailable");
    expect(run.calls).toEqual([primary.model]);
  });

  it("should not fall back when the validated output cannot be written", async () => {
    let calls = 0;
    const policy = createRefreshModelPolicy({ primary, fallback, forceFallback: false, timeoutMs: 1000,
      createClient(model) {
        return { mode: "mesh", provider: model.provider, model: model.model,
          async generateJson(request) {
            calls++;
            await request.validateResponse?.("{}");
            throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
          } };
      } });
    await expect(policy.forDocument("one", async () => {}).generateJson(input)).rejects.toThrow("disk full");
    expect(calls).toBe(1);
  });
});
