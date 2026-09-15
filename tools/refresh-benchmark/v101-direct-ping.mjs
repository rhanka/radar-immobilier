import { prompt, safeUsage, textFromOpenAi } from "./v101-probe-lib.mjs";

async function postJson(url, headers, body) {
  const started = Date.now();
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    if (error && typeof error === "object") error.requestCount = 1;
    throw error;
  }
  const payload = await response.json().catch(() => null);
  const limitNames = ["retry-after", "x-ratelimit-limit-requests", "x-ratelimit-limit-tokens",
    "x-ratelimit-remaining-requests", "x-ratelimit-remaining-tokens",
    "x-ratelimit-reset-requests", "x-ratelimit-reset-tokens",
    "anthropic-ratelimit-requests-limit", "anthropic-ratelimit-tokens-limit"];
  const limits = Object.fromEntries(limitNames
    .map((name) => [name, response.headers.get(name)])
    .filter(([, value]) => value !== null));
  return { response, payload, latencyMs: Date.now() - started, limits };
}

export async function pingOpenAi(model) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is absent");
  const { response, payload, latencyMs, limits } = await postJson(
    "https://api.openai.com/v1/responses",
    { authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}` },
    { model, input: prompt, max_output_tokens: 64 },
  );
  const output = response.ok ? textFromOpenAi(payload) : "";
  return {
    httpStatus: response.status,
    latencyMs,
    resolvedModelId: response.ok ? payload?.model ?? null : null,
    finishReason: payload?.status ?? null,
    output,
    pingExact: output === "PING_OK",
    usage: safeUsage(payload?.usage),
    limits,
    requestCount: 1,
    error: response.ok ? null : { category: "http", status: response.status },
  };
}

export async function pingAnthropic(model, effort) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is absent");
  const { response, payload, latencyMs, limits } = await postJson(
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": process.env.ANTHROPIC_API_KEY ?? "", "anthropic-version": "2023-06-01" },
    { model, max_tokens: 64, messages: [{ role: "user", content: prompt }],
      ...(effort && effort !== "off"
        ? { thinking: { type: "adaptive" }, output_config: { effort } } : {}) },
  );
  const output = response.ok
    ? (payload?.content ?? []).filter(({ type }) => type === "text")
      .map(({ text }) => text).join("").trim()
    : "";
  return {
    httpStatus: response.status,
    latencyMs,
    resolvedModelId: response.ok ? payload?.model ?? null : null,
    finishReason: payload?.stop_reason ?? null,
    output,
    pingExact: output === "PING_OK",
    usage: safeUsage(payload?.usage),
    limits,
    requestCount: 1,
    error: response.ok ? null : { category: "http", status: response.status },
  };
}

export async function pingMistral(model) {
  if (!process.env.MISTRAL_API_KEY) throw new Error("MISTRAL_API_KEY is absent");
  const { response, payload, latencyMs, limits } = await postJson(
    "https://api.mistral.ai/v1/chat/completions",
    { authorization: `Bearer ${process.env.MISTRAL_API_KEY ?? ""}` },
    { model, max_tokens: 64, messages: [{ role: "user", content: prompt }] },
  );
  const output = response.ok ? String(payload?.choices?.[0]?.message?.content ?? "").trim() : "";
  return {
    httpStatus: response.status,
    latencyMs,
    resolvedModelId: response.ok ? payload?.model ?? null : null,
    finishReason: payload?.choices?.[0]?.finish_reason ?? null,
    output,
    pingExact: output === "PING_OK",
    usage: safeUsage(payload?.usage),
    limits,
    requestCount: 1,
    error: response.ok ? null : { category: "http", status: response.status },
  };
}
