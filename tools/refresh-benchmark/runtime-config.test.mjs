import assert from "node:assert/strict";
import test from "node:test";

import { createAdapterSet, inspectCloudCodeSse, inspectWireBody, resolveOutputCap,
  selectAccount, validateRetry, variants } from
  "./runtime-config.mjs";

test("v4 candidates use the lowest explicit effort on enrolled transports", () => {
  assert.deepEqual(variants["luna-low"], {
    provider: "openai", transport: "codex", model: "gpt-5.6-luna", effort: "low",
  });
  assert.deepEqual(variants["gemini-low"], {
    provider: "gemini", transport: "cloud-code", model: "gemini-3.8-flash-tiered", effort: "low",
  });
});

test("v8 changes only Gemini effort on the same catalog wire model", () => {
  assert.deepEqual(variants["gemini-high"], {
    provider: "gemini", transport: "cloud-code", model: "gemini-3.8-flash-tiered", effort: "high",
  });
  assert.deepEqual(inspectWireBody(variants["gemini-high"], {
    model: "gemini-3.8-flash-tiered", request: { generationConfig: {
      maxOutputTokens: 65_536, thinkingConfig: { thinkingLevel: "HIGH" },
    } },
  }, 65_536), { model: "gemini-3.8-flash-tiered", effort: "high",
    providerEffort: "HIGH", maxOutputTokens: 65_536 });
});

test("account selection is owner-scoped by facade and transport-specific", () => {
  const accounts = [{ accountId: "c", providerId: "codex" },
    { accountId: "g", providerId: "cloud-code" }];
  assert.equal(selectAccount(accounts, variants["luna-low"]).accountId, "c");
  assert.equal(selectAccount(accounts, variants["gemini-low"]).accountId, "g");
  assert.throws(() => selectAccount(accounts.slice(0, 1), variants["gemini-low"]),
    /one cloud-code enrollment, found 0/);
});

test("outgoing wire evidence proves provider model, effort, and cap", () => {
  assert.deepEqual(inspectWireBody(variants["luna-low"], {
    model: "gpt-5.6-luna", reasoning: { effort: "low" }, max_output_tokens: 16384,
  }), { model: "gpt-5.6-luna", effort: "low", providerEffort: "low", maxOutputTokens: 16384 });
  assert.deepEqual(inspectWireBody(variants["luna-low"], {
    model: "gpt-5.6-luna", reasoning: { effort: "low" },
  }), { model: "gpt-5.6-luna", effort: "low", providerEffort: "low", maxOutputTokens: null });
  assert.deepEqual(inspectWireBody(variants["gemini-low"], {
    model: "gemini-3.8-flash-tiered", request: { generationConfig: {
      maxOutputTokens: 16384, thinkingConfig: { thinkingLevel: "LOW" },
    } },
  }), { model: "gemini-3.8-flash-tiered", effort: "low", providerEffort: "LOW", maxOutputTokens: 16384 });
  assert.throws(() => inspectWireBody(variants["gemini-low"], {
    model: "gemini-3.8-flash-tiered", request: { generationConfig: {
      maxOutputTokens: 16384, thinkingConfig: { thinkingLevel: "HIGH" },
    } },
  }), /Observed effort differs/);
});

test("the elevated cap is restricted to the single Valcourt diagnosis", () => {
  const context = { campaign: "v5", documentId: "valcourt-2026-06-01-agenda",
    variantName: "gemini-low" };
  assert.equal(resolveOutputCap(undefined, context, 16_384), 16_384);
  assert.equal(resolveOutputCap("65536", context, 16_384), 65_536);
  assert.throws(() => resolveOutputCap("65536", { ...context, documentId: "waterloo" }, 16_384),
    /restricted to the Valcourt/);
});

test("the frozen v7 cap applies without a diagnostic override", () => {
  const context = { campaign: "v7", documentId: "waterloo-2026-08-18",
    variantName: "gemini-low" };
  assert.equal(resolveOutputCap(undefined, context, 65_536), 65_536);
  assert.throws(() => resolveOutputCap("16384", context, 65_536), /restricted to the Valcourt/);
});

test("the frozen v8 cap applies without a diagnostic override", () => {
  const context = { campaign: "v8", documentId: "waterloo-2026-08-18",
    variantName: "gemini-high" };
  assert.equal(resolveOutputCap(undefined, context, 65_536), 65_536);
  assert.throws(() => resolveOutputCap("16384", context, 65_536), /restricted to the Valcourt/);
});

test("the frozen v9 replay cap applies without a diagnostic override", () => {
  const context = { campaign: "v9", documentId: "waterloo-2026-08-18",
    variantName: "gemini-low" };
  assert.equal(resolveOutputCap(undefined, context, 65_536), 65_536);
  assert.throws(() => resolveOutputCap("16384", context, 65_536), /restricted to the Valcourt/);
});

test("terminal Cloud Code SSE evidence retains only closure metadata", () => {
  const transcript = [
    'data: {"response":{"candidates":[{"content":{"parts":[{"text":"secret body"}]}}]}}',
    'data: {"response":{"candidates":[{"finishReason":"MAX_TOKENS"}],"usageMetadata":'
      + '{"promptTokenCount":10,"candidatesTokenCount":20,"thoughtsTokenCount":3,'
      + '"totalTokenCount":33,"sensitive":"discard"}}}',
    "data: [DONE]", "",
  ].join("\n");
  assert.deepEqual(inspectCloudCodeSse(transcript), { dataEventCount: 2, doneMarker: true,
    lastData: { hasFinishReason: true, finishReason: "MAX_TOKENS", hasUsageMetadata: true,
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20,
        thoughtsTokenCount: 3, totalTokenCount: 33 } } });
  assert.doesNotMatch(JSON.stringify(inspectCloudCodeSse(transcript)), /secret body|sensitive/);
});

test("adapter construction is identical across the frozen Graphify boundary", () => {
  class Client { constructor(options) { this.options = options; } }
  class Adapter { constructor(options) { Object.assign(this, options); } }
  const observedFetch = () => undefined;
  const adapters = createAdapterSet({
    CloudCodeRuntimeClient: Client, CodexRuntimeClient: Client,
    GeminiAdapter: Adapter, OpenAIAdapter: Adapter,
    getModelProfile: () => ({ providerId: "gemini", modelId: "gemini-3.8-flash" }),
  }, observedFetch);
  assert.equal(adapters.gemini.client.options, observedFetch);
  assert.equal(adapters.gemini.models[0].modelId, "gemini-3.8-flash-tiered");
  assert.deepEqual(adapters.openai.client.options, { fetch: observedFetch });
});

test("every variant has the same single transport-retry policy", () => {
  for (const variant of Object.values(variants)) {
    assert.doesNotThrow(() => validateRetry({ attemptNumber: 1, previousReceipt: null }));
    assert.doesNotThrow(() => validateRetry({ attemptNumber: 2, retryReason: "transport",
      previousReceipt: { status: "failed", actual: null, variant } }));
    assert.throws(() => validateRetry({ attemptNumber: 2, retryReason: "quality",
      previousReceipt: { status: "failed", actual: {} } }), /only after a transport failure/);
  }
});
