import { CloudCodeRuntimeClient } from
  "/workspace/node_modules/@sentropic/llm-mesh/dist/index.js";

const sanitize = (value) => String(value ?? "N-A").slice(0, 500)
  .replace(/sk-ant-[A-Za-z0-9_-]+/gu, "[REDACTED]")
  .replace(/(Bearer\s+)\S+/giu, "$1[REDACTED]");
const contentText = (content) => typeof content === "string" ? content
  : content.filter(({ type }) => type === "text").map(({ text }) => text).join("");

async function generateDirect(request, observedFetch) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required");
  const system = request.messages.filter(({ role }) => role === "system")
    .map(({ content }) => contentText(content)).join("\n\n");
  const body = JSON.stringify({ model: request.modelId,
    max_tokens: request.maxOutputTokens,
    ...(system ? { system } : {}),
    messages: request.messages.filter(({ role }) => role !== "system")
      .map(({ role, content }) => ({ role, content: contentText(content) })) });
  const response = await observedFetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: request.signal,
    headers: { "content-type": "application/json", "x-api-key": apiKey,
      "anthropic-version": "2023-06-01" }, body,
  });
  const responseText = await response.text();
  let payload;
  try { payload = JSON.parse(responseText); }
  catch { throw new Error(`Anthropic HTTP ${response.status}: invalid JSON response`); }
  if (!response.ok) {
    throw new Error(`Anthropic HTTP ${response.status}: ${sanitize(payload?.error?.message)}`);
  }
  const text = (payload.content ?? []).filter(({ type }) => type === "text")
    .map((part) => part.text).join("");
  const inputTokens = payload.usage?.input_tokens ?? 0;
  const outputTokens = payload.usage?.output_tokens ?? 0;
  return { id: payload.id ?? "anthropic_response", providerId: "anthropic",
    modelId: payload.model ?? request.modelId, text, message: { role: "assistant", content: text },
    finishReason: payload.stop_reason ?? "stop", toolCalls: [],
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens,
      providerRawUsage: payload.usage ?? null } };
}

async function generateCloudCode(request, observedFetch, facade, account, ownerScope, affinityKey) {
  const acquisition = await facade.acquire({ accountId: account.accountId,
    ownerScopeRef: ownerScope, targetProviderId: "gemini", transportProviderId: "cloud-code",
    modelId: request.modelId, affinityKey, requestId: `sonnet-v12-${Date.now()}` });
  try {
    return await new CloudCodeRuntimeClient(observedFetch).generate(request,
      { auth: acquisition.material });
  } finally {
    await facade.release(acquisition);
  }
}

export async function generateSonnet({ variant, request, observedFetch, facade, account,
  ownerScope, affinityKey }) {
  if (variant.transport === "anthropic-direct") return generateDirect(request, observedFetch);
  if (variant.transport === "cloud-code") {
    return generateCloudCode(request, observedFetch, facade, account, ownerScope, affinityKey);
  }
  throw new Error(`Unsupported Sonnet transport: ${variant.transport}`);
}
