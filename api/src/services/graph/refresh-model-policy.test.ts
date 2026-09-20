import type { TextJsonGenerationClient } from "@sentropic/graphify";
import { describe, expect, it, vi } from "vitest";

import { createRefreshModelPolicy, type RefreshModel, type RefreshModelReceipt } from "./refresh-model-policy.js";

const primary: RefreshModel = { provider: "gemini", model: "gemini-3.8-flash", effort: "low" };
const fallback: RefreshModel = { provider: "openai", model: "gpt-6-astra", effort: "low" };
const input = { prompt: "Extract", schema: "{}", validateResponse: () => {} };
function fixture(generate: (model: RefreshModel, signal: AbortSignal) => Promise<string>, forceFallback = false,
  signal?: AbortSignal, primaryQualityAttempts = 2) {
  const calls: string[] = [];
  const receipts: RefreshModelReceipt[] = [];
  const policy = createRefreshModelPolicy({ primary, fallback, forceFallback, primaryQualityAttempts, timeoutMs: 50,
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

  it("should enforce timeout even when primary ignores cancellation and resolves late", async () => {
    vi.useFakeTimers();
    try {
      let finishPrimary: (value: string) => void = () => {};
      const run = fixture(async (model) => model === primary
        ? new Promise<string>((resolve) => { finishPrimary = resolve; }) : "{}");
      const validate = vi.fn();
      const pending = run.document("one").generateJson({ ...input, validateResponse: validate });
      await vi.advanceTimersByTimeAsync(50);
      await pending;
      expect(run.receipts).toMatchObject([{ status: "failed", failureReason: "timeout" },
        { status: "completed", fallbackReason: "timeout" }]);
      finishPrimary('{"late":true}');
      await vi.advanceTimersByTimeAsync(1);
      expect(validate).toHaveBeenCalledTimes(1);
      expect(validate).toHaveBeenCalledWith("{}");
    } finally { vi.useRealTimers(); }
  });

  it.each(["failed-status", "wrong-model", "status-without-text"])("should refuse a resolved invalid result (%s)", async (kind) => {
    const receipts: RefreshModelReceipt[] = [];
    let calls = 0;
    const policy = createRefreshModelPolicy({ primary, fallback, forceFallback: false, primaryQualityAttempts: 2, timeoutMs: 1000,
      createClient(model) {
        return { mode: "mesh", provider: model.provider, model: model.model, async generateJson(request) {
          calls++;
          if (kind !== "status-without-text") await request.validateResponse?.("{}");
          return { status: kind !== "wrong-model" ? "instructions_written" : "completed", mode: "mesh",
            provider: model.provider, model: kind === "wrong-model" ? "unexpected" : model.model, audit: {} };
        } };
      } });
    await expect(policy.forDocument("one", async (receipt) => { receipts.push(receipt); })
      .generateJson(input)).rejects.toThrow();
    expect(calls).toBe(1);
    expect(receipts[0]?.status).toBe("failed");
    expect(receipts[0]?.terminalFailure).toBe(true);
    if (kind === "wrong-model") expect(receipts[0]?.modelUsed).toBeNull();
    policy.restoreDocument("one", receipts);
    await expect(policy.forDocument("one", async () => {}).generateJson(input)).rejects.toThrow("terminal receipt");
    expect(calls).toBe(1);
  });

  it("should retry a quality refusal once on Gemini then fall back to Astra", async () => {
    const run = fixture(async () => "bad output");
    await expect(run.document("one").generateJson({ ...input,
      validateResponse() { throw new Error("Invalid profile extraction"); } })).rejects.toThrow("Invalid profile extraction");
    expect(run.calls).toEqual([primary.model, primary.model, fallback.model]);
    expect(run.receipts).toMatchObject([
      { modelUsed: primary, status: "quality-refused", attempt: 1, transition: "primary" },
      { modelUsed: primary, status: "quality-refused", attempt: 2, transition: "same-model-retry" },
      { modelUsed: fallback, status: "quality-refused", attempt: 3, transition: "fallback", fallbackReason: "quality" },
    ]);
  });

  it("should fall back without a Gemini retry when quality attempts is one", async () => {
    const run = fixture(async () => "bad output", false, undefined, 1);
    await expect(run.document("one").generateJson({ ...input,
      validateResponse() { throw new Error("Invalid JSON"); } })).rejects.toThrow("Invalid JSON");
    expect(run.calls).toEqual([primary.model, fallback.model]);
    expect(run.receipts).toMatchObject([
      { attempt: 1, transition: "primary", status: "quality-refused" },
      { attempt: 2, transition: "fallback", fallbackReason: "quality" },
    ]);
  });

  it("should retain the bounded Gemini quality retry after durable resume", async () => {
    const run = fixture(async () => "{}");
    run.policy.restoreDocument("one", [
      { modelUsed: primary, status: "quality-refused", attempt: 1, transition: "primary", latencyMs: 1 },
      { modelUsed: primary, status: "quality-refused", attempt: 2, transition: "same-model-retry", latencyMs: 1 },
    ]);
    await run.document("one").generateJson(input);
    expect(run.calls).toEqual([fallback.model]);
    expect(run.receipts).toMatchObject([
      { modelUsed: fallback, attempt: 3, transition: "fallback", fallbackReason: "quality", status: "completed" },
    ]);
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

  it("should declare the FALLBACK seat exhausted after three consecutive quota refusals",
    async () => {
      // The primary's circuit spares the cities behind it a call known to be
      // refused. Nothing covered the fallback: every remaining city of a
      // 528-city sweep paid its own 429, failed, and the sweep carried on.
      const run = fixture(async () => { throw Object.assign(new Error("limited"), { status: 429 }); });
      expect(run.policy.fallbackQuotaExhausted()).toBe(false);
      for (const id of ["a", "b"]) {
        await expect(run.document(id).generateJson(input)).rejects.toThrow("limited");
      }
      expect(run.policy.fallbackQuotaExhausted()).toBe(false);
      await expect(run.document("c").generateJson(input)).rejects.toThrow("limited");
      expect(run.policy.fallbackQuotaExhausted()).toBe(true);
    });

  it("should not confuse a transport failure of the fallback with a dry seat", async () => {
    const run = fixture(async () => { throw new Error("network"); });
    for (const id of ["a", "b", "c", "d"]) {
      await expect(run.document(id).generateJson(input)).rejects.toThrow("network");
    }
    expect(run.policy.fallbackQuotaExhausted()).toBe(false);
  });

  it("should forget a finished document, since one policy now spans 528 cities", async () => {
    // The attempt counter lives in the per-document entry. A finished document
    // whose entry is released starts from one again — which is the observable
    // proof that the map does not grow for four hours across 528 cities.
    const run = fixture(async () => "{}");
    await run.document("one").generateJson(input);
    expect(run.receipts.at(-1)).toMatchObject({ attempt: 1 });
    await run.document("one").generateJson(input);
    expect(run.receipts.at(-1)).toMatchObject({ attempt: 2 });

    run.policy.completeDocument("one");
    await run.document("one").generateJson(input);
    expect(run.receipts.at(-1)).toMatchObject({ attempt: 1 });
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

  it("should restore fallback affinity for an incomplete document in a new cycle", async () => {
    const initial = fixture(async (model) => {
      if (model === primary) throw Object.assign(new Error("quota"), { status: 429 });
      return "{}";
    });
    await initial.document("one").generateJson(input);
    const resumed = fixture(async () => "{}");
    resumed.policy.restoreDocument("one", initial.receipts);
    await resumed.document("one").generateJson(input);
    expect(resumed.calls).toEqual([fallback.model]);
    expect(resumed.receipts[0]?.fallbackReason).toBe("quota");
    await resumed.document("two").generateJson(input);
    expect(resumed.calls.at(-1)).toBe(primary.model);
  });

  it("should count new quota failures on documents resumed after primary-only chunks", async () => {
    const run = fixture(async (model) => {
      if (model === primary) throw Object.assign(new Error("quota"), { status: 429 });
      return "{}";
    });
    for (const id of ["a", "b", "c"]) {
      run.policy.restoreDocument(id, [{ modelUsed: primary, status: "completed", attempt: 1,
        transition: "primary", latencyMs: 1 }]);
      await run.document(id).generateJson(input);
      run.policy.completeDocument(id);
    }
    await run.document("d").generateJson(input);
    expect(run.calls.filter((model) => model === primary.model)).toHaveLength(3);
    expect(run.receipts.at(-1)?.fallbackReason).toBe("circuit-open");
  });

  it("should not fall back when the validated output cannot be written", async () => {
    let calls = 0;
    const policy = createRefreshModelPolicy({ primary, fallback, forceFallback: false, primaryQualityAttempts: 2, timeoutMs: 1000,
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
