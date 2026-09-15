import { CloudCodeRuntimeClient, CodexRuntimeClient } from
  "/workspace/node_modules/@sentropic/llm-mesh/dist/index.js";
import { createLlmMeshFacade } from
  "/workspace/node_modules/@sentropic/llm-mesh/dist/service/facade.js";
import { EncryptedFileKeyring } from
  "/workspace/node_modules/@sentropic/llm-mesh/dist/node/index.js";

import { endpointPath, prompt, safeUsage, sha256 } from "./v101-probe-lib.mjs";

function accountFor(accounts, providerId) {
  const eligible = accounts.filter((account) => account.providerId === providerId);
  if (eligible.length !== 1) {
    throw new Error(`Expected one ${providerId} enrollment, found ${eligible.length}`);
  }
  return eligible[0];
}

export async function pingMesh({ transport, model, effort }) {
  const ownerScope = process.env.BENCHMARK_OWNER_SCOPE;
  if (!ownerScope) throw new Error("BENCHMARK_OWNER_SCOPE is required");
  const facade = createLlmMeshFacade({
    mode: "cli",
    configResolver: { async resolveConfig() { return {}; } },
    keyring: new EncryptedFileKeyring("/run/benchmark-keyring"),
  });
  const account = accountFor(await facade.listAccounts({ ownerScope }), transport);
  const targetProviderId = transport === "codex" ? "openai" : "gemini";
  const acquisition = await facade.acquire({
    accountId: account.accountId,
    ownerScopeRef: ownerScope,
    targetProviderId,
    transportProviderId: transport,
    modelId: model,
    affinityKey: `v101-ping-${model}`,
    requestId: `v101-ping-${Date.now()}`,
  });
  const wire = [];
  const observedFetch = async (url, init = {}) => {
    if (wire.length >= 3) throw new Error("Phase-1 request ceiling reached");
    const started = Date.now();
    let body = null;
    try { body = JSON.parse(String(init.body ?? "")); } catch { body = null; }
    const timeoutSignal = AbortSignal.timeout(60_000);
    const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
    const request = {
      endpoint: endpointPath(url),
      method: init.method ?? "GET",
      httpStatus: null,
      durationMs: null,
      model: body?.model ?? null,
      effort: body?.reasoning?.effort
        ?? body?.request?.generationConfig?.thinkingConfig?.thinkingLevel ?? null,
      maxOutputTokens: body?.max_output_tokens
        ?? body?.request?.generationConfig?.maxOutputTokens ?? null };
    wire.push(request);
    const response = await fetch(url, { ...init, signal });
    request.httpStatus = response.status;
    request.durationMs = Date.now() - started;
    return response;
  };
  const client = transport === "codex"
    ? new CodexRuntimeClient({ fetch: observedFetch })
    : new CloudCodeRuntimeClient(observedFetch);
  const started = Date.now();
  try {
    const response = await client.generate({
      modelId: model,
      messages: [{ role: "user", content: prompt }],
      ...(effort ? { reasoning: { effort } } : {}),
      maxOutputTokens: 64,
      signal: AbortSignal.timeout(60_000),
    }, { auth: acquisition.material });
    const output = String(response.text ?? "").trim();
    return {
      httpStatus: wire.at(-1)?.httpStatus ?? null,
      latencyMs: Date.now() - started,
      resolvedModelId: response.modelId ?? null,
      wireModelId: wire.at(-1)?.model ?? null,
      finishReason: response.finishReason ?? null,
      output,
      pingExact: output === "PING_OK",
      usage: safeUsage(response.usage),
      wire,
      requestCount: wire.length,
      accountPseudonym: `acct-${sha256(account.accountId).slice(0, 10)}`,
      error: null,
    };
  } catch (error) {
    return {
      httpStatus: wire.at(-1)?.httpStatus ?? null,
      latencyMs: Date.now() - started,
      resolvedModelId: null,
      wireModelId: wire.at(-1)?.model ?? null,
      finishReason: null,
      output: "",
      pingExact: false,
      usage: null,
      wire,
      requestCount: wire.length,
      accountPseudonym: `acct-${sha256(account.accountId).slice(0, 10)}`,
      error: { category: "transport",
        code: typeof error?.code === "string" ? error.code : null,
        statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : null },
    };
  } finally {
    await facade.release(acquisition);
  }
}
