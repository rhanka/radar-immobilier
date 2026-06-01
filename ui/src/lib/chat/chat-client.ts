/**
 * ÉV9 — Browser chat client.
 *
 * Thin wrapper around the radar chat API + the real `@sentropic/chat-ui`
 * `StreamHub`. The `StreamHub` opens an EventSource on
 * `${baseUrl}/streams/sse` and de-duplicates frames by `{ streamId,
 * sequence }`; `StreamMessage.svelte` subscribes to a single `streamId` via
 * `streamClient.setStream(...)`. We point `baseUrl` at the radar chat API so
 * the hub consumes our real streamed LLM tokens.
 */

import { createStreamHub } from "@sentropic/chat-ui/client/streamHub";
import type { StreamHubClient } from "@sentropic/chat-ui/client/streamTypes";

export type ChatModelChoice = {
  modelId: string;
  label: string;
};

export type ChatProvider = {
  id: string;
  label: string;
  defaultModel: string;
  models: ChatModelChoice[];
};

export type ProvidersResponse = {
  providers: ChatProvider[];
  configured: boolean;
};

export type ChatTurn = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** Base URL of the chat API. Same-origin via the Vite proxy in dev. */
const apiBase = (): string => {
  const raw = import.meta.env.VITE_API_BASE_URL;
  return raw ? raw.replace(/\/$/, "") : "";
};

const chatBase = (): string => `${apiBase()}/api/chat`;

export const fetchProviders = async (): Promise<ProvidersResponse> => {
  const response = await fetch(`${chatBase()}/providers`);
  if (!response.ok) {
    throw new Error(`providers HTTP ${response.status}`);
  }
  return (await response.json()) as ProvidersResponse;
};

export type StartMessageResult = {
  streamId: string;
  providerId: string;
  model: string;
};

export const startMessage = async (input: {
  providerId: string;
  model?: string;
  messages: ChatTurn[];
}): Promise<StartMessageResult> => {
  const response = await fetch(`${chatBase()}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(detail?.error ?? `messages HTTP ${response.status}`);
  }
  return (await response.json()) as StartMessageResult;
};

let hub: StreamHubClient | null = null;

/**
 * Singleton StreamHub bound to the radar chat SSE feed. Always "authed"
 * (the radar demo has no auth) so the hub connects as soon as a stream is
 * subscribed. Note the hub appends `/streams/sse` to the base URL itself.
 */
export const getStreamHub = (): StreamHubClient => {
  if (hub) return hub;
  hub = createStreamHub({
    getBaseUrl: () => chatBase(),
    getAuthState: () => true,
    getUrlBaseOrigin: () =>
      typeof window === "undefined" ? undefined : window.location.origin,
    reconnectDelayMs: 50,
  });
  return hub;
};
