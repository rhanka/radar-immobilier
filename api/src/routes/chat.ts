/**
 * ÉV9 — Real chat HTTP/SSE endpoint (Hono).
 *
 * Mirrors the `../sentropic` shape (a chat router mounted under the api,
 * an SSE stream the browser `StreamHub` consumes, and a provider listing
 * endpoint) but trimmed to the radar demo's needs: no auth, no Postgres,
 * single in-memory stream bus, real streamed tokens via the
 * `MeshDispatchPort` → `@sentropic/llm-mesh` wiring.
 *
 *   GET  /api/chat/providers       — providers actually configured via env
 *   POST /api/chat/messages        — start a streamed assistant turn
 *   GET  /api/chat/streams/sse     — StreamHub SSE (named events)
 *
 * feat(chat): Each assistant turn now injects a live radar context snapshot
 * (cities with zonage changes, top opportunities) into the system prompt so
 * the LLM can answer factual questions about the radar without fabricating
 * data. The context is fetched from the internal endpoints before the turn
 * starts. If the fetch fails, a degraded-mode note is injected instead.
 */

import { Hono } from "hono";
import { z } from "zod";

import {
  apiKeyFor,
  BACKLOG_TOOLS,
  defaultModelFor,
  isConfiguredProvider,
  listConfiguredProviders,
  streamChatTurns,
  supportsTools,
  type ChatTurn,
} from "../services/chat/mesh-runtime.js";
import { executeBacklogTool } from "../services/chat/backlog-tools.js";
import {
  publish,
  replayAll,
  subscribe,
  type StreamFrame,
} from "../services/chat/stream-bus.js";
import {
  buildRadarContext,
  serializeRadarContext,
} from "../services/chat/radar-context.js";

const chatTurnSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

const createMessageSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().min(1).optional(),
  messages: z.array(chatTurnSchema).min(1),
});

/**
 * Static part of the system prompt (role, language, guardrails, backlog tools).
 * The live radar context snapshot is appended at call time.
 */
const SYSTEM_PROMPT_BASE =
  "Tu es l'assistant du radar immobilier. " +
  "Reponds en francais, de maniere concise et factuelle, en t'appuyant " +
  "uniquement sur les informations fournies dans le contexte radar ci-dessous. " +
  "N'invente jamais de fait, de reglement, de zone ni de lot. " +
  "Si la donnee demandee n'est pas dans le contexte, dis-le clairement. " +
  "Tu disposes de deux outils pour piloter le backlog des evolutions : " +
  "appelle ajouter_demande(titre, description) des que l'utilisateur souhaite " +
  "une nouvelle fonctionnalite, amelioration ou correction ; appelle " +
  "traiter_demande(id) quand il demande de demarrer le traitement d'une " +
  "demande deja ajoutee. Confirme ensuite a l'utilisateur ce qui a ete fait.\n\n";

/**
 * Translate a mesh `StreamEvent` to the wire shape the browser `StreamMessage`
 * component expects (snake_case `tool_call_id`, `name`, `args`, `result`),
 * mirroring sentropic's `writeStreamEvent` payloads. Returns the event type +
 * the UI-shaped data to publish.
 */
const toUiFrame = (
  type: string,
  data: unknown,
): { type: string; data: unknown } => {
  const record = (data ?? {}) as Record<string, unknown>;
  if (type === "tool_call_start") {
    return {
      type,
      data: {
        tool_call_id: record.toolCallId,
        name: record.name,
        args: record.argumentsText ?? "",
      },
    };
  }
  if (type === "tool_call_delta") {
    return {
      type,
      data: { tool_call_id: record.toolCallId, delta: record.delta ?? "" },
    };
  }
  if (type === "tool_call_result") {
    return {
      type,
      data: { tool_call_id: record.toolCallId, result: record.output },
    };
  }
  return { type, data };
};

const sseFrame = (event: string, payload: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;

const randomStreamId = (): string =>
  `radar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function chatRoute(): Hono {
  const app = new Hono();

  /** Providers configured via env, neutral alphabetical order. */
  app.get("/api/chat/providers", (c) => {
    const providers = listConfiguredProviders();
    return c.json({
      providers: providers.map((provider) => ({
        id: provider.providerId,
        label: provider.label,
        defaultModel: provider.defaultModel,
        models: provider.models,
      })),
      configured: providers.length > 0,
    });
  });

  /** Browser StreamHub SSE feed (replay buffer + live frames). */
  app.get("/api/chat/streams/sse", (c) => {
    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (frame: StreamFrame): void => {
          controller.enqueue(
            encoder.encode(
              sseFrame(frame.type, {
                streamId: frame.streamId,
                sequence: frame.sequence,
                data: frame.data,
              }),
            ),
          );
        };
        replayAll(send);
        unsubscribe = subscribe(send);
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(sseFrame("ping", { ts: Date.now() })));
          } catch {
            // controller already closed
          }
        }, 15000);
      },
      cancel() {
        if (unsubscribe) unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
      },
    });

    c.header("Content-Type", "text/event-stream; charset=utf-8");
    c.header("Cache-Control", "no-cache, no-transform");
    c.header("Connection", "keep-alive");
    return c.body(stream);
  });

  /** Start a streamed assistant turn; returns the streamId to subscribe to. */
  app.post("/api/chat/messages", async (c) => {
    const parsed = createMessageSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return c.json(
        { error: "Invalid request", details: parsed.error.issues },
        400,
      );
    }

    const { providerId, model, messages } = parsed.data;
    if (!isConfiguredProvider(providerId)) {
      return c.json(
        { error: `Provider "${providerId}" is not configured` },
        400,
      );
    }

    const streamId = randomStreamId();
    const resolvedModel = model ?? defaultModelFor(providerId);

    // Prepend the radar system prompt (with live context) unless the caller
    // already sent a system turn. Context is fetched asynchronously before the
    // LLM call in the background task so the POST response is instant.
    const hasSystem = messages.some((message) => message.role === "system");

    // Run the assistant turn in the background; the browser subscribes to
    // the SSE feed and renders frames as they arrive. Tool-capable providers
    // (OpenAI + Anthropic) get the backlog tools so the chat can add/process
    // backlog items; other providers stream text only.
    void (async () => {
      await publish(streamId, "status", { status: "started", providerId, modelId: resolvedModel });

      // Build live radar context and inject it into the system prompt.
      // Errors are caught inside buildRadarContext (returns ok:false), so the
      // turn always proceeds — the assistant gracefully acknowledges missing data.
      let turns: Array<{ role: "system" | "user" | "assistant"; content: string }>;
      if (hasSystem) {
        turns = messages as typeof turns;
      } else {
        const radarCtx = await buildRadarContext();
        const systemContent = SYSTEM_PROMPT_BASE + serializeRadarContext(radarCtx);
        turns = [{ role: "system" as const, content: systemContent }, ...messages];
      }
      try {
        const apiKey = apiKeyFor(providerId);
        if (!apiKey) {
          throw new Error(`No API key configured for provider "${providerId}"`);
        }
        const events = streamChatTurns({
          providerId,
          model: resolvedModel,
          apiKey,
          messages: turns as ChatTurn[],
          ...(supportsTools(providerId) ? { tools: BACKLOG_TOOLS } : {}),
          executeTool: async (call) => {
            const result = await executeBacklogTool({
              name: call.name,
              argumentsText: call.argumentsText,
            });
            // The model needs a compact textual summary to react to.
            const content = result.error
              ? `Erreur : ${result.error}`
              : result.summary;
            return { content, result };
          },
        });
        for await (const event of events) {
          const frame = toUiFrame(event.type, event.data);
          await publish(streamId, frame.type, frame.data);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown chat error";
        await publish(streamId, "error", { message });
        await publish(streamId, "done", { finishReason: "error" });
      }
    })();

    return c.json({ streamId, providerId, model: resolvedModel });
  });

  return app;
}
