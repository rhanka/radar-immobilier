/**
 * ÉV9 — Real chat runtime wiring (mirror of `../sentropic`
 * `api/src/services/llm-runtime/mesh-dispatch.ts`).
 *
 * Builds a provider-agnostic `@sentropic/llm-mesh` mesh:
 *
 *   createLlmMesh({ registry: createProviderRegistry([
 *     new OpenAIAdapter({ client, models }), ... ]) })
 *
 * `@sentropic/llm-mesh` ships the adapter contract but not the concrete
 * HTTP clients, so (exactly like sentropic's `ApplicationProviderMeshClient`)
 * we inject a single `ProviderAdapterClient` that dispatches to the real
 * provider HTTP streaming APIs and yields normalized `StreamEvent`s. Each
 * adapter is registered with the model profiles we actually use (the mesh
 * rejects unknown model ids), reusing the provider capability matrix from
 * the catalog. Keys are read from the environment only — never hardcoded.
 */

import {
  AnthropicAdapter,
  CohereAdapter,
  GeminiAdapter,
  MistralAdapter,
  OpenAIAdapter,
  createLlmMesh,
  createProviderRegistry,
  getSecretAuthMaterial,
  providerProfiles,
  type GenerateRequest,
  type GenerateResponse,
  type LlmMeshMessage,
  type ModelProfile,
  type ProviderAdapter,
  type ProviderAdapterClient,
  type ProviderId,
  type ProviderRuntimeContext,
  type StreamEvent,
  type StreamRequest,
  type StreamResult,
} from "@sentropic/llm-mesh";

type ProviderMeta = {
  label: string;
  defaultModel: string;
  envVars: readonly string[];
};

/**
 * Provider metadata. Labels are neutral and no provider is favored; default
 * models are broadly available, current, and comparable across providers.
 * The `gemini` entry accepts both common key names (sentropic uses
 * `GEMINI_API_KEY`, the radar `.env.example` ships `GOOGLE_API_KEY`).
 * The `satisfies` clause keeps every key present so lookups are total.
 */
const PROVIDER_META = {
  anthropic: {
    label: "Anthropic Claude",
    defaultModel: "claude-3-5-haiku-latest",
    envVars: ["ANTHROPIC_API_KEY"],
  },
  cohere: {
    label: "Cohere",
    defaultModel: "command-r",
    envVars: ["COHERE_API_KEY"],
  },
  gemini: {
    label: "Google Gemini",
    defaultModel: "gemini-1.5-flash",
    envVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  },
  mistral: {
    label: "Mistral AI",
    defaultModel: "mistral-small-latest",
    envVars: ["MISTRAL_API_KEY"],
  },
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-4o-mini",
    envVars: ["OPENAI_API_KEY"],
  },
} satisfies Record<ProviderId, ProviderMeta>;

/** Providers exposed by the demo chat, in neutral alphabetical order. */
export const CHAT_PROVIDER_IDS = [
  "anthropic",
  "cohere",
  "gemini",
  "mistral",
  "openai",
] as const satisfies readonly ProviderId[];

export type ProviderConfig = {
  providerId: ProviderId;
  label: string;
  defaultModel: string;
};

const readApiKey = (
  providerId: ProviderId,
  env: NodeJS.ProcessEnv,
): string | undefined => {
  for (const name of PROVIDER_META[providerId].envVars) {
    const value = env[name];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
};

/** Provider ids that have a non-empty API key configured in the env. */
export const listConfiguredProviders = (
  env: NodeJS.ProcessEnv = process.env,
): ProviderConfig[] =>
  CHAT_PROVIDER_IDS.filter((id) => readApiKey(id, env) !== undefined).map(
    (providerId) => ({
      providerId,
      label: PROVIDER_META[providerId].label,
      defaultModel: PROVIDER_META[providerId].defaultModel,
    }),
  );

export const isConfiguredProvider = (
  providerId: string,
  env: NodeJS.ProcessEnv = process.env,
): providerId is ProviderId =>
  (CHAT_PROVIDER_IDS as readonly string[]).includes(providerId) &&
  readApiKey(providerId as ProviderId, env) !== undefined;

export const defaultModelFor = (providerId: ProviderId): string =>
  PROVIDER_META[providerId].defaultModel;

type TextPart = { type: "text"; text: string };
const isTextPart = (part: { type: string }): part is TextPart =>
  part.type === "text";

const extractCredential = (request: GenerateRequest): string | undefined => {
  const auth = typeof request.auth === "function" ? undefined : request.auth;
  const material = getSecretAuthMaterial(auth);
  if (!material) return undefined;
  if (material.type === "direct-token") return material.token;
  if (material.type === "user-token" || material.type === "workspace-token") {
    return material.token;
  }
  if (material.type === "environment-token") return material.token;
  return undefined;
};

const messageText = (content: LlmMeshMessage["content"]): string => {
  if (typeof content === "string") return content;
  return content
    .filter(isTextPart)
    .map((part) => part.text)
    .join("");
};

type ChatTurn = { role: "system" | "user" | "assistant"; content: string };

const toTurns = (messages: readonly LlmMeshMessage[]): ChatTurn[] =>
  messages.map((message) => {
    const role =
      message.role === "system" ||
      message.role === "assistant" ||
      message.role === "user"
        ? message.role
        : "user";
    return { role, content: messageText(message.content) };
  });

const contentDelta = (delta: string): StreamEvent => ({
  type: "content_delta",
  data: { delta },
});

const doneEvent = (providerId: ProviderId, modelId: string): StreamEvent => ({
  type: "done",
  data: { finishReason: "stop", providerId, modelId },
});

/**
 * Real provider client. Each `stream()` call dispatches to the provider's
 * native streaming HTTP API and re-emits normalized `content_delta` /
 * `done` / `error` events. `generate()` collects the stream.
 */
class RadarProviderMeshClient implements ProviderAdapterClient {
  async generate(
    request: GenerateRequest,
    context?: ProviderRuntimeContext,
  ): Promise<GenerateResponse> {
    const providerId = (request.providerId ?? "openai") as ProviderId;
    const modelId = request.modelId ?? defaultModelFor(providerId);
    let text = "";
    for await (const event of await this.stream(
      request as StreamRequest,
      context,
    )) {
      if (event.type === "content_delta") {
        text += event.data.delta;
      }
    }
    return {
      id: `${providerId}_${Date.now()}`,
      providerId,
      modelId,
      message: { role: "assistant", content: text },
      text,
      toolCalls: [],
      finishReason: "stop",
    };
  }

  async stream(
    request: StreamRequest,
    _context?: ProviderRuntimeContext,
  ): Promise<StreamResult> {
    const providerId = (request.providerId ?? "openai") as ProviderId;
    const modelId = request.modelId ?? defaultModelFor(providerId);
    const credential = extractCredential(request);
    if (!credential) {
      throw new Error(`No API key configured for provider "${providerId}"`);
    }
    const turns = toTurns(request.messages);
    const signal = request.signal;

    switch (providerId) {
      case "anthropic":
        return streamAnthropic(modelId, credential, turns, signal);
      case "gemini":
        return streamGemini(modelId, credential, turns, signal);
      case "cohere":
        return streamCohere(modelId, credential, turns, signal);
      case "openai":
      case "mistral":
        return streamOpenAiCompatible(
          providerId,
          modelId,
          credential,
          turns,
          signal,
        );
      default:
        throw new Error(`Unsupported provider "${providerId as string}"`);
    }
  }
}

/** Split system turns from chat turns (Anthropic/Gemini want them apart). */
const splitSystem = (
  turns: readonly ChatTurn[],
): { system: string; chat: ChatTurn[] } => {
  const system = turns
    .filter((turn) => turn.role === "system")
    .map((turn) => turn.content)
    .join("\n\n");
  const chat = turns.filter((turn) => turn.role !== "system");
  return { system, chat };
};

/**
 * Generic SSE line reader: yields each `data:` payload string of a
 * text/event-stream response body.
 */
async function* readSse(
  response: Response,
): AsyncGenerator<string, void, unknown> {
  const body = response.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line.startsWith("data:")) {
          yield line.slice("data:".length).trim();
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

const ensureOk = async (
  response: Response,
  providerId: ProviderId,
): Promise<void> => {
  if (response.ok) return;
  const detail = await response.text().catch(() => "");
  throw new Error(
    `${providerId} HTTP ${response.status}: ${detail.slice(0, 500)}`,
  );
};

async function* streamOpenAiCompatible(
  providerId: ProviderId,
  modelId: string,
  apiKey: string,
  turns: readonly ChatTurn[],
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent, void, unknown> {
  const baseUrl =
    providerId === "mistral"
      ? "https://api.mistral.ai/v1/chat/completions"
      : "https://api.openai.com/v1/chat/completions";
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      stream: true,
      messages: turns.map((turn) => ({
        role: turn.role,
        content: turn.content,
      })),
    }),
    ...(signal ? { signal } : {}),
  });
  await ensureOk(response, providerId);
  for await (const payload of readSse(response)) {
    if (payload === "[DONE]") break;
    try {
      const parsed = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: string } }>;
      };
      const delta = parsed.choices?.[0]?.delta?.content;
      if (delta) yield contentDelta(delta);
    } catch {
      // ignore keep-alive / non-JSON frames
    }
  }
  yield doneEvent(providerId, modelId);
}

async function* streamAnthropic(
  modelId: string,
  apiKey: string,
  turns: readonly ChatTurn[],
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent, void, unknown> {
  const { system, chat } = splitSystem(turns);
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 1024,
      stream: true,
      ...(system ? { system } : {}),
      messages: chat.map((turn) => ({
        role: turn.role === "assistant" ? "assistant" : "user",
        content: turn.content,
      })),
    }),
    ...(signal ? { signal } : {}),
  });
  await ensureOk(response, "anthropic");
  for await (const payload of readSse(response)) {
    try {
      const parsed = JSON.parse(payload) as {
        type?: string;
        delta?: { type?: string; text?: string };
      };
      if (
        parsed.type === "content_block_delta" &&
        parsed.delta?.type === "text_delta" &&
        parsed.delta.text
      ) {
        yield contentDelta(parsed.delta.text);
      }
    } catch {
      // ignore non-JSON frames
    }
  }
  yield doneEvent("anthropic", modelId);
}

async function* streamGemini(
  modelId: string,
  apiKey: string,
  turns: readonly ChatTurn[],
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent, void, unknown> {
  const { system, chat } = splitSystem(turns);
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...(system
        ? { systemInstruction: { parts: [{ text: system }] } }
        : {}),
      contents: chat.map((turn) => ({
        role: turn.role === "assistant" ? "model" : "user",
        parts: [{ text: turn.content }],
      })),
    }),
    ...(signal ? { signal } : {}),
  });
  await ensureOk(response, "gemini");
  for await (const payload of readSse(response)) {
    try {
      const parsed = JSON.parse(payload) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };
      const parts = parsed.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (part.text) yield contentDelta(part.text);
      }
    } catch {
      // ignore non-JSON frames
    }
  }
  yield doneEvent("gemini", modelId);
}

async function* streamCohere(
  modelId: string,
  apiKey: string,
  turns: readonly ChatTurn[],
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent, void, unknown> {
  const response = await fetch("https://api.cohere.com/v2/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      stream: true,
      messages: turns.map((turn) => ({
        role: turn.role,
        content: turn.content,
      })),
    }),
    ...(signal ? { signal } : {}),
  });
  await ensureOk(response, "cohere");
  for await (const payload of readSse(response)) {
    try {
      const parsed = JSON.parse(payload) as {
        type?: string;
        delta?: { message?: { content?: { text?: string } } };
      };
      const text = parsed.delta?.message?.content?.text;
      if (parsed.type === "content-delta" && text) {
        yield contentDelta(text);
      }
    } catch {
      // ignore non-JSON frames
    }
  }
  yield doneEvent("cohere", modelId);
}

const radarProviderClient = new RadarProviderMeshClient();

/**
 * Register the model we actually use for each provider. The mesh rejects
 * unknown model ids, so we declare a single profile per provider reusing
 * the provider's capability matrix from the catalog. `reasoningTier` is
 * conservative ("none") since the demo chat does not drive reasoning.
 */
const modelProfileFor = (providerId: ProviderId): ModelProfile =>
  ({
    providerId,
    modelId: PROVIDER_META[providerId].defaultModel,
    label: PROVIDER_META[providerId].label,
    reasoningTier: "none",
    defaultTaskHints: ["chat"],
    capabilities: providerProfiles[providerId].capabilities,
  }) as ModelProfile;

/**
 * Application-wide mesh. Mirrors sentropic's `applicationLlmMesh`: a single
 * client instance wired into every adapter so the provider is selected per
 * request via `request.providerId`.
 */
const adapters: readonly ProviderAdapter[] = [
  new AnthropicAdapter({
    client: radarProviderClient,
    models: [modelProfileFor("anthropic")],
  }),
  new CohereAdapter({
    client: radarProviderClient,
    models: [modelProfileFor("cohere")],
  }),
  new GeminiAdapter({
    client: radarProviderClient,
    models: [modelProfileFor("gemini")],
  }),
  new MistralAdapter({
    client: radarProviderClient,
    models: [modelProfileFor("mistral")],
  }),
  new OpenAIAdapter({
    client: radarProviderClient,
    models: [modelProfileFor("openai")],
  }),
];

export const radarLlmMesh = createLlmMesh({
  registry: createProviderRegistry(adapters),
});

/** Build a mesh `StreamRequest` from a configured provider + chat turns. */
export const buildStreamRequest = (input: {
  providerId: ProviderId;
  model: string;
  apiKey: string;
  messages: readonly ChatTurn[];
  signal?: AbortSignal;
}): StreamRequest => ({
  providerId: input.providerId,
  modelId: input.model,
  messages: input.messages,
  auth: { type: "direct-token", token: input.apiKey, label: "environment" },
  ...(input.signal ? { signal: input.signal } : {}),
});

export const apiKeyFor = (
  providerId: ProviderId,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined => readApiKey(providerId, env);

export type { ChatTurn };
