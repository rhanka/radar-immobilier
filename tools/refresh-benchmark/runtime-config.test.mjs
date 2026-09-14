import assert from "node:assert/strict";
import test from "node:test";

import { createAdapterSet, inspectWireBody, selectAccount, validateRetry, variants } from
  "./runtime-config.mjs";

test("v4 candidates use the lowest explicit effort on enrolled transports", () => {
  assert.deepEqual(variants["luna-low"], {
    provider: "openai", transport: "codex", model: "gpt-5.6-luna", effort: "low",
  });
  assert.deepEqual(variants["gemini-low"], {
    provider: "gemini", transport: "cloud-code", model: "gemini-3.8-flash-tiered", effort: "low",
  });
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
