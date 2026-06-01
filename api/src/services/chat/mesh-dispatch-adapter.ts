/**
 * ÉV9 — MeshDispatchAdapter (mirror of `../sentropic`
 * `api/src/services/chat/mesh-dispatch-adapter.ts`).
 *
 * Implements the contracts-free `MeshDispatchPort` from
 * `@sentropic/chat-core` over the real `@sentropic/llm-mesh` mesh built in
 * `./mesh-runtime.ts`. Keeping this boundary means the chat orchestration
 * never imports `@sentropic/llm-mesh` directly — exactly the isolation the
 * chat-core port was designed for.
 */

import type {
  MeshDispatchPort,
  MeshInvokeRequest,
  MeshInvokeResponse,
  MeshStreamEvent,
  MeshStreamRequest,
} from "@sentropic/chat-core";
import type { LlmMeshMessage, ProviderId, StreamEvent } from "@sentropic/llm-mesh";

import {
  apiKeyFor,
  buildStreamRequest,
  defaultModelFor,
  radarLlmMesh,
  type ChatTurn,
} from "./mesh-runtime.js";

const toChatTurns = (messages: ReadonlyArray<unknown>): ChatTurn[] =>
  messages.map((raw) => {
    const message = raw as Partial<LlmMeshMessage> & { content?: unknown };
    const role =
      message.role === "system" ||
      message.role === "assistant" ||
      message.role === "user"
        ? message.role
        : "user";
    const content =
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content ?? "");
    return { role, content };
  });

export class MeshDispatchAdapter implements MeshDispatchPort {
  async invoke(request: MeshInvokeRequest): Promise<MeshInvokeResponse> {
    const providerId = (request.providerId ?? "openai") as ProviderId;
    const model = request.model ?? defaultModelFor(providerId);
    const apiKey = request.credential ?? apiKeyFor(providerId);
    if (!apiKey) {
      throw new Error(`No API key configured for provider "${providerId}"`);
    }
    const response = await radarLlmMesh.generate(
      buildStreamRequest({
        providerId,
        model,
        apiKey,
        messages: toChatTurns(request.messages),
        ...(request.signal ? { signal: request.signal } : {}),
      }),
    );
    return { raw: response };
  }

  async *invokeStream(
    request: MeshStreamRequest,
  ): AsyncIterable<MeshStreamEvent> {
    const providerId = (request.providerId ?? "openai") as ProviderId;
    const model = request.model ?? defaultModelFor(providerId);
    const apiKey = request.credential ?? apiKeyFor(providerId);
    if (!apiKey) {
      throw new Error(`No API key configured for provider "${providerId}"`);
    }
    const stream = await radarLlmMesh.stream(
      buildStreamRequest({
        providerId,
        model,
        apiKey,
        messages: toChatTurns(request.messages),
        ...(request.signal ? { signal: request.signal } : {}),
      }),
    );
    for await (const event of stream as AsyncIterable<StreamEvent>) {
      yield { type: event.type, data: event.data } as MeshStreamEvent;
    }
  }
}

export const meshDispatchAdapter = new MeshDispatchAdapter();
