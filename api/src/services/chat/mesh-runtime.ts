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
  type ToolDefinition,
} from "@sentropic/llm-mesh";

type ModelChoice = { modelId: string; label: string };

type ProviderMeta = {
  label: string;
  defaultModel: string;
  models: readonly ModelChoice[];
  envVars: readonly string[];
};

/**
 * Provider metadata. Labels are neutral and no provider is favored; default
 * models are broadly available, current, and comparable across providers.
 * The `gemini` entry accepts both common key names (sentropic uses
 * `GEMINI_API_KEY`, the radar `.env.example` ships `GOOGLE_API_KEY`).
 * The `satisfies` clause keeps every key present so lookups are total.
 */
// Shortlist de modèles reprise telle quelle du catalogue sentropic
// (`../sentropic/packages/llm-mesh/src/catalog.ts`) : ne rien inventer.
// `defaultModel` = un modèle léger/rapide de la liste, adapté à la démo.
const PROVIDER_META = {
  anthropic: {
    label: "Anthropic Claude",
    defaultModel: "claude-sonnet-4-6",
    models: [
      { modelId: "claude-sonnet-4-6", label: "Sonnet 4.6" },
      { modelId: "claude-opus-4-7", label: "Opus 4.7" },
    ],
    envVars: ["ANTHROPIC_API_KEY"],
  },
  cohere: {
    label: "Cohere",
    defaultModel: "command-a-03-2025",
    models: [
      { modelId: "command-a-03-2025", label: "Command A" },
      { modelId: "command-a-reasoning-08-2025", label: "Command A R." },
    ],
    envVars: ["COHERE_API_KEY"],
  },
  gemini: {
    label: "Google Gemini",
    defaultModel: "gemini-3.1-flash-lite",
    models: [
      { modelId: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
      { modelId: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite" },
    ],
    envVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  },
  mistral: {
    label: "Mistral AI",
    defaultModel: "mistral-small-2603",
    models: [
      { modelId: "mistral-small-2603", label: "Mistral Small 4" },
      { modelId: "magistral-medium-2509", label: "Magistral Medium" },
    ],
    envVars: ["MISTRAL_API_KEY"],
  },
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-4.1-nano",
    models: [
      { modelId: "gpt-5.5", label: "GPT-5.5" },
      { modelId: "gpt-5.4-nano", label: "GPT-5.4 Nano" },
      { modelId: "gpt-4.1-nano", label: "GPT-4.1 Nano" },
    ],
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
  models: readonly ModelChoice[];
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
      models: PROVIDER_META[providerId].models,
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

/** One tool call requested by the assistant in a turn. */
export type ToolCallTurn = {
  id: string;
  name: string;
  /** Raw JSON arguments text the model produced. */
  argumentsText: string;
};

/** Result of executing a tool call, fed back into the conversation. */
export type ToolResultTurn = {
  id: string;
  name: string;
  /** JSON-serializable content returned to the model. */
  content: string;
};

/**
 * A conversation turn. Beyond plain text roles, the loop appends:
 * - an `assistant` turn carrying `toolCalls` (the model asked to call tools),
 * - one `tool` turn per executed call carrying its `result`.
 * Each provider serializer maps these to its native wire shape.
 */
type ChatTurn =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "assistant"; content: string; toolCalls: ToolCallTurn[] }
  | { role: "tool"; result: ToolResultTurn };

const hasToolCalls = (
  turn: ChatTurn,
): turn is { role: "assistant"; content: string; toolCalls: ToolCallTurn[] } =>
  turn.role === "assistant" && "toolCalls" in turn && turn.toolCalls.length > 0;

const isToolTurn = (
  turn: ChatTurn,
): turn is { role: "tool"; result: ToolResultTurn } => turn.role === "tool";

const toTurns = (messages: readonly LlmMeshMessage[]): ChatTurn[] =>
  messages.map((raw): ChatTurn => {
    // `buildStreamRequest` carries our rich `ChatTurn` union as the mesh
    // `messages` (the radar client is the only consumer), so preserve tool
    // turns instead of flattening them to `{ role, content }`.
    const message = raw as unknown as ChatTurn;
    if (isToolTurn(message)) return message;
    if (hasToolCalls(message)) return message;
    const role =
      raw.role === "system" || raw.role === "assistant" || raw.role === "user"
        ? raw.role
        : "user";
    return { role, content: messageText(raw.content) };
  });

const contentDelta = (delta: string): StreamEvent => ({
  type: "content_delta",
  data: { delta },
});

const toolCallStart = (call: ToolCallTurn): StreamEvent => ({
  type: "tool_call_start",
  data: {
    toolCallId: call.id,
    name: call.name,
    argumentsText: call.argumentsText,
  },
});

const toolCallDelta = (id: string, delta: string): StreamEvent => ({
  type: "tool_call_delta",
  data: { toolCallId: id, delta },
});

const doneEvent = (
  providerId: ProviderId,
  modelId: string,
  finishReason: "stop" | "tool_calls" = "stop",
): StreamEvent => ({
  type: "done",
  data: { finishReason, providerId, modelId },
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
    // Only the two providers the user named carry tools (OpenAI + Anthropic).
    // Other providers stream text-only and gracefully ignore tools.
    const tools = supportsTools(providerId) ? request.tools : undefined;

    switch (providerId) {
      case "anthropic":
        return streamAnthropic(modelId, credential, turns, tools, signal);
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
          providerId === "openai" ? tools : undefined,
          signal,
        );
      default:
        throw new Error(`Unsupported provider "${providerId as string}"`);
    }
  }
}

/**
 * Providers wired for tool-calling. The user named OpenAI + Anthropic; both
 * have native streaming tool-call protocols implemented below. Other providers
 * keep text-only chat (no crash) and silently ignore any tool definitions.
 */
const TOOL_CAPABLE_PROVIDERS = new Set<ProviderId>(["anthropic", "openai"]);

export const supportsTools = (providerId: ProviderId): boolean =>
  TOOL_CAPABLE_PROVIDERS.has(providerId);

/** Split system turns from chat turns (Anthropic/Gemini want them apart). */
/** Plain text of a turn (tool turns have none). */
const turnText = (turn: ChatTurn): string =>
  "content" in turn ? turn.content : "";

const splitSystem = (
  turns: readonly ChatTurn[],
): { system: string; chat: ChatTurn[] } => {
  const system = turns
    .filter((turn) => turn.role === "system")
    .map((turn) => turnText(turn))
    .join("\n\n");
  const chat = turns.filter((turn) => turn.role !== "system");
  return { system, chat };
};

/** Map our `ToolDefinition`s to the OpenAI `tools` array shape. */
const toOpenAiTools = (
  tools: readonly ToolDefinition[],
): unknown[] =>
  tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));

/** Map our `ToolDefinition`s to the Anthropic `tools` array shape. */
const toAnthropicTools = (
  tools: readonly ToolDefinition[],
): unknown[] =>
  tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));

/** Serialize our turn union to the OpenAI chat-completions message shape. */
const toOpenAiMessages = (turns: readonly ChatTurn[]): unknown[] =>
  turns.map((turn) => {
    if (isToolTurn(turn)) {
      return {
        role: "tool",
        tool_call_id: turn.result.id,
        content: turn.result.content,
      };
    }
    if (hasToolCalls(turn)) {
      return {
        role: "assistant",
        content: turn.content || null,
        tool_calls: turn.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.argumentsText },
        })),
      };
    }
    return { role: turn.role, content: turnText(turn) };
  });

/** Serialize our turn union to the Anthropic messages shape. */
const toAnthropicMessages = (turns: readonly ChatTurn[]): unknown[] =>
  turns.map((turn) => {
    if (isToolTurn(turn)) {
      return {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: turn.result.id,
            content: turn.result.content,
          },
        ],
      };
    }
    if (hasToolCalls(turn)) {
      const blocks: unknown[] = [];
      if (turn.content) blocks.push({ type: "text", text: turn.content });
      for (const call of turn.toolCalls) {
        let parsedInput: unknown = {};
        try {
          parsedInput = call.argumentsText.trim().length
            ? JSON.parse(call.argumentsText)
            : {};
        } catch {
          parsedInput = {};
        }
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: parsedInput,
        });
      }
      return { role: "assistant", content: blocks };
    }
    return {
      role: turn.role === "assistant" ? "assistant" : "user",
      content: turnText(turn),
    };
  });

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

/** Accumulator for an OpenAI streamed tool call (indexed by delta `index`). */
type OpenAiToolCallAcc = { id: string; name: string; args: string };

async function* streamOpenAiCompatible(
  providerId: ProviderId,
  modelId: string,
  apiKey: string,
  turns: readonly ChatTurn[],
  tools: readonly ToolDefinition[] | undefined,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent, void, unknown> {
  const baseUrl =
    providerId === "mistral"
      ? "https://api.mistral.ai/v1/chat/completions"
      : "https://api.openai.com/v1/chat/completions";
  const useTools = tools && tools.length > 0;
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      stream: true,
      messages: toOpenAiMessages(turns),
      ...(useTools ? { tools: toOpenAiTools(tools), tool_choice: "auto" } : {}),
    }),
    ...(signal ? { signal } : {}),
  });
  await ensureOk(response, providerId);

  const pending = new Map<number, OpenAiToolCallAcc>();
  const started = new Set<number>();
  let sawToolCall = false;

  for await (const payload of readSse(response)) {
    if (payload === "[DONE]") break;
    try {
      const parsed = JSON.parse(payload) as {
        choices?: Array<{
          delta?: {
            content?: string;
            tool_calls?: Array<{
              index?: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
          finish_reason?: string;
        }>;
      };
      const choice = parsed.choices?.[0];
      const delta = choice?.delta?.content;
      if (delta) yield contentDelta(delta);

      for (const tc of choice?.delta?.tool_calls ?? []) {
        sawToolCall = true;
        const index = tc.index ?? 0;
        const acc = pending.get(index) ?? { id: "", name: "", args: "" };
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name = tc.function.name;
        const argsDelta = tc.function?.arguments ?? "";
        if (argsDelta) acc.args += argsDelta;
        pending.set(index, acc);
        // Emit a start the first time we know the name; deltas afterwards.
        if (!started.has(index) && acc.name) {
          started.add(index);
          yield toolCallStart({
            id: acc.id || `call_${index}`,
            name: acc.name,
            argumentsText: "",
          });
        }
        if (started.has(index) && argsDelta) {
          yield toolCallDelta(acc.id || `call_${index}`, argsDelta);
        }
      }
    } catch {
      // ignore keep-alive / non-JSON frames
    }
  }

  if (sawToolCall) {
    // Re-emit final accumulated tool calls (start carries full args) so the
    // orchestration loop can collect them deterministically from the stream.
    for (const [index, acc] of pending) {
      yield toolCallStart({
        id: acc.id || `call_${index}`,
        name: acc.name,
        argumentsText: acc.args,
      });
    }
    yield doneEvent(providerId, modelId, "tool_calls");
    return;
  }
  yield doneEvent(providerId, modelId);
}

/** Accumulator for an Anthropic `tool_use` content block (indexed by block). */
type AnthropicToolUseAcc = { id: string; name: string; args: string };

async function* streamAnthropic(
  modelId: string,
  apiKey: string,
  turns: readonly ChatTurn[],
  tools: readonly ToolDefinition[] | undefined,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent, void, unknown> {
  const { system, chat } = splitSystem(turns);
  const useTools = tools && tools.length > 0;
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
      ...(useTools ? { tools: toAnthropicTools(tools) } : {}),
      messages: toAnthropicMessages(chat),
    }),
    ...(signal ? { signal } : {}),
  });
  await ensureOk(response, "anthropic");

  const toolBlocks = new Map<number, AnthropicToolUseAcc>();
  let stopReason: string | undefined;

  for await (const payload of readSse(response)) {
    try {
      const parsed = JSON.parse(payload) as {
        type?: string;
        index?: number;
        content_block?: { type?: string; id?: string; name?: string };
        delta?: {
          type?: string;
          text?: string;
          partial_json?: string;
          stop_reason?: string;
        };
      };
      if (
        parsed.type === "content_block_start" &&
        parsed.content_block?.type === "tool_use"
      ) {
        const index = parsed.index ?? 0;
        const acc = {
          id: parsed.content_block.id ?? `toolu_${index}`,
          name: parsed.content_block.name ?? "",
          args: "",
        };
        toolBlocks.set(index, acc);
        yield toolCallStart({ id: acc.id, name: acc.name, argumentsText: "" });
      } else if (
        parsed.type === "content_block_delta" &&
        parsed.delta?.type === "text_delta" &&
        parsed.delta.text
      ) {
        yield contentDelta(parsed.delta.text);
      } else if (
        parsed.type === "content_block_delta" &&
        parsed.delta?.type === "input_json_delta" &&
        typeof parsed.delta.partial_json === "string"
      ) {
        const index = parsed.index ?? 0;
        const acc = toolBlocks.get(index);
        if (acc) {
          acc.args += parsed.delta.partial_json;
          yield toolCallDelta(acc.id, parsed.delta.partial_json);
        }
      } else if (parsed.type === "message_delta" && parsed.delta?.stop_reason) {
        stopReason = parsed.delta.stop_reason;
      }
    } catch {
      // ignore non-JSON frames
    }
  }

  if (stopReason === "tool_use" && toolBlocks.size > 0) {
    // Re-emit final tool calls with complete args for deterministic collection.
    for (const acc of toolBlocks.values()) {
      yield toolCallStart({
        id: acc.id,
        name: acc.name,
        argumentsText: acc.args,
      });
    }
    yield doneEvent("anthropic", modelId, "tool_calls");
    return;
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
        parts: [{ text: turnText(turn) }],
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
        content: turnText(turn),
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
const modelProfilesFor = (providerId: ProviderId): ModelProfile[] =>
  PROVIDER_META[providerId].models.map(
    (choice) =>
      ({
        providerId,
        modelId: choice.modelId,
        label: choice.label,
        reasoningTier: "none",
        defaultTaskHints: ["chat"],
        capabilities: providerProfiles[providerId].capabilities,
      }) as ModelProfile,
  );

/**
 * Application-wide mesh. Mirrors sentropic's `applicationLlmMesh`: a single
 * client instance wired into every adapter so the provider is selected per
 * request via `request.providerId`.
 */
const adapters: readonly ProviderAdapter[] = [
  new AnthropicAdapter({
    client: radarProviderClient,
    models: modelProfilesFor("anthropic"),
  }),
  new CohereAdapter({
    client: radarProviderClient,
    models: modelProfilesFor("cohere"),
  }),
  new GeminiAdapter({
    client: radarProviderClient,
    models: modelProfilesFor("gemini"),
  }),
  new MistralAdapter({
    client: radarProviderClient,
    models: modelProfilesFor("mistral"),
  }),
  new OpenAIAdapter({
    client: radarProviderClient,
    models: modelProfilesFor("openai"),
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
  tools?: readonly ToolDefinition[];
  signal?: AbortSignal;
}): StreamRequest => ({
  providerId: input.providerId,
  modelId: input.model,
  // The radar client is the only consumer of these messages and understands
  // our rich `ChatTurn` union (tool turns included), so the cast is safe.
  messages: input.messages as unknown as readonly LlmMeshMessage[],
  auth: { type: "direct-token", token: input.apiKey, label: "environment" },
  ...(input.tools && input.tools.length > 0 ? { tools: input.tools } : {}),
  ...(input.signal ? { signal: input.signal } : {}),
});

export const apiKeyFor = (
  providerId: ProviderId,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined => readApiKey(providerId, env);

/** Max tool rounds in a single turn (guards against runaway loops). */
const MAX_TOOL_ROUNDS = 4;

/** Outcome of executing one tool call, supplied by the caller. */
export type ToolExecution = {
  /** JSON-serializable content fed back to the model. */
  content: string;
  /** Opaque result object surfaced to the UI via `tool_call_result`. */
  result: unknown;
};

/**
 * Stream one chat turn with tool-calling support, mirroring sentropic's
 * tool-execution loop: stream a model turn; if it finishes with tool calls,
 * execute each via `executeTool`, append the assistant tool-call turn + the
 * tool-result turns to the conversation, and stream the next round. Yields
 * normalized `StreamEvent`s throughout (content + tool_call_start/delta +
 * tool_call_result) plus a final `done`. The loop is bounded by
 * `MAX_TOOL_ROUNDS`.
 */
export async function* streamChatTurns(input: {
  providerId: ProviderId;
  model: string;
  apiKey: string;
  messages: readonly ChatTurn[];
  tools?: readonly ToolDefinition[];
  executeTool: (call: ToolCallTurn) => Promise<ToolExecution>;
  signal?: AbortSignal;
}): AsyncGenerator<StreamEvent, void, unknown> {
  const conversation: ChatTurn[] = [...input.messages];
  const useTools =
    supportsTools(input.providerId) &&
    input.tools !== undefined &&
    input.tools.length > 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const stream = await radarLlmMesh.stream(
      buildStreamRequest({
        providerId: input.providerId,
        model: input.model,
        apiKey: input.apiKey,
        messages: conversation,
        ...(useTools ? { tools: input.tools } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      }),
    );

    // Collect tool calls from the stream; forward every event except the
    // intermediate `done(tool_calls)` (a single terminal `done` is emitted
    // by the loop). De-duplicate tool calls by id (streamers re-emit a final
    // start carrying the complete args).
    const calls = new Map<string, ToolCallTurn>();
    let assistantText = "";
    let finishedWithTools = false;

    for await (const event of stream as AsyncIterable<StreamEvent>) {
      if (event.type === "content_delta") {
        assistantText += event.data.delta;
        yield event;
      } else if (event.type === "tool_call_start") {
        const data = event.data;
        const id = data.toolCallId;
        const existing = calls.get(id);
        // Keep the variant carrying the longest argumentsText (final re-emit).
        if (!existing || data.argumentsText.length >= existing.argumentsText.length) {
          calls.set(id, {
            id,
            name: data.name,
            argumentsText: data.argumentsText,
          });
        }
        yield event;
      } else if (event.type === "tool_call_delta") {
        yield event;
      } else if (event.type === "done") {
        finishedWithTools = event.data.finishReason === "tool_calls";
        if (!finishedWithTools) {
          yield event;
        }
      } else {
        yield event;
      }
    }

    if (!finishedWithTools || calls.size === 0) {
      return;
    }

    // Append the assistant tool-call turn, then execute + append results.
    const toolCalls = [...calls.values()];
    conversation.push({ role: "assistant", content: assistantText, toolCalls });
    for (const call of toolCalls) {
      const execution = await input.executeTool(call);
      conversation.push({
        role: "tool",
        result: { id: call.id, name: call.name, content: execution.content },
      });
      yield {
        type: "tool_call_result",
        data: { toolCallId: call.id, name: call.name, output: execution.result },
      };
    }
    // Loop to let the model react to the tool results.
  }

  // Exhausted the tool rounds: close the stream cleanly.
  yield doneEvent(input.providerId, input.model);
}

export { BACKLOG_TOOLS } from "./backlog-tools.js";

export type { ChatTurn };
