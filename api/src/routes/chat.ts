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
 */

import { Hono } from "hono";
import { z } from "zod";

import { meshDispatchAdapter } from "../services/chat/mesh-dispatch-adapter.js";
import {
  defaultModelFor,
  isConfiguredProvider,
  listConfiguredProviders,
} from "../services/chat/mesh-runtime.js";
import {
  publish,
  replayAll,
  subscribe,
  type StreamFrame,
} from "../services/chat/stream-bus.js";

const chatTurnSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

const createMessageSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().min(1).optional(),
  messages: z.array(chatTurnSchema).min(1),
});

const SYSTEM_PROMPT =
  "Tu es l'assistant du radar immobilier de Salaberry-de-Valleyfield. " +
  "Reponds en francais, de maniere concise et factuelle, en t'appuyant " +
  "uniquement sur les informations fournies. N'invente jamais de fait, " +
  "de reglement, de zone ni de lot.";

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

    // Prepend the radar system prompt unless the caller already sent one.
    const hasSystem = messages.some((message) => message.role === "system");
    const turns = hasSystem
      ? messages
      : [{ role: "system" as const, content: SYSTEM_PROMPT }, ...messages];

    // Run the assistant turn in the background; the browser subscribes to
    // the SSE feed and renders frames as they arrive.
    void (async () => {
      await publish(streamId, "status", { status: "started", providerId, modelId: resolvedModel });
      try {
        const events = meshDispatchAdapter.invokeStream({
          providerId,
          model: resolvedModel,
          messages: turns,
        });
        for await (const event of events) {
          await publish(streamId, event.type, event.data);
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
