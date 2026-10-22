/**
 * 6L2 invalidation signals: gated decisions, cursor tracking and
 * acknowledgment guards over the 6L1 reconciliation state. INACTIVE until
 * 6K retires the old delivery paths: `enabled` defaults to false. Every
 * acknowledgment requires the event context to still match the live viewer
 * incarnation and workspace; late responses are ignored and failed refetches
 * acknowledge nothing.
 */
import {
  isLiveScopedContext,
  type ScopedViewerContext,
} from "./signal-facet-scope.js";
import {
  beginProjectionRead, createProjectionSync, noteProjectionSuccess, shouldReconcile,
  type ProjectionSyncState,
} from "./signal-projection-revision.js";

/** Gate: 6K flips this only after retiring the old delivery paths. */
export const PROJECTION_INVALIDATION_ENABLED = false;
/** Reconnect delay after a dropped stream; the cursor resumes or resyncs. */
export const PROJECTION_RECONNECT_DELAY_MS = 1000;

export interface ProjectionInvalidationContext extends ScopedViewerContext {
  citySlug: string;
  mode: string;
}

export interface ProjectionSnapshot {
  token: string;
}

export interface ProjectionInvalidationSync extends ProjectionSyncState {
  enabled: boolean;
  cursor: string | null;
}

export function createProjectionInvalidationSync(
  launched: ProjectionInvalidationContext,
  options: { enabled?: boolean; cursor?: string | null } = {},
): ProjectionInvalidationSync {
  return {
    ...createProjectionSync(launched),
    enabled: options.enabled ?? PROJECTION_INVALIDATION_ENABLED,
    cursor: options.cursor ?? null,
  };
}

/** True when the remote token differs from the last acknowledged token. */
export function shouldFetchAfterEvent(state: ProjectionInvalidationSync, token: string): boolean {
  return shouldReconcile(state, token);
}

export type StreamSignal = "fetch" | "resync" | "closed" | "ignore";

export interface StreamEvent {
  kind: "invalidated" | "resync" | "closed" | "unavailable" | "ping";
  token?: string;
  cursor?: string;
}

/** Parse one named SSE frame; unknown or malformed frames yield null. */
export function parseProjectionStreamEvent(event: string, data: string): StreamEvent | null {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  if (event === "ping" || event === "unavailable") return { kind: event };
  if (event === "closed") return { kind: "closed" };
  if (event === "invalidated" || event === "resync") {
    if (typeof payload.token !== "string") return null;
    const stream: StreamEvent = { kind: event, token: payload.token };
    if (typeof payload.cursor === "string") stream.cursor = payload.cursor;
    return stream;
  }
  return null;
}

/**
 * Decide what one stream event requires: "fetch" for a newer token,
 * "resync" for a forced reload, "closed" when the watcher revoked the viewer
 * (the owner clears the context through the authorization path), "ignore"
 * for gated, superseded, duplicate or unknown frames. Resync adopts the
 * delivered cursor for the next reconnection.
 */
export function noteInvalidationEvent(
  state: ProjectionInvalidationSync,
  live: ProjectionInvalidationContext,
  streamEvent: StreamEvent | null,
): StreamSignal {
  if (!state.enabled || streamEvent === null) return "ignore";
  if (!isLiveScopedContext(state.launched, live)) return "ignore";
  if (state.launched.citySlug !== live.citySlug || state.launched.mode !== live.mode) return "ignore";
  if (streamEvent.kind === "closed") {
    state.operation += 1;
    state.enabled = false;
    state.ackedToken = null;
    state.snapshot = null;
    state.cursor = null;
    state.launched = { ...state.launched, viewerKey: null, workspaceId: null };
    return "closed";
  }
  if (streamEvent.kind === "unavailable" || streamEvent.kind === "ping") return "ignore";
  if (streamEvent.kind === "resync") {
    if (typeof streamEvent.cursor === "string") state.cursor = streamEvent.cursor;
    return "resync";
  }
  if (streamEvent.token !== undefined && !shouldFetchAfterEvent(state, streamEvent.token)) return "ignore";
  return "fetch";
}

/** Begin one invalidation-triggered fetch; superseded fetches ack nothing. */
export function beginInvalidationFetch(state: ProjectionInvalidationSync): number {
  return beginProjectionRead(state);
}

/** Acknowledge a coherent refetch only when the response context is live. */
export function noteInvalidationReconciled<T extends ProjectionSnapshot>(
  state: ProjectionInvalidationSync,
  live: ProjectionInvalidationContext,
  snapshot: T,
  operation: number,
): boolean {
  if (!state.enabled) return false;
  return noteProjectionSuccess(state, live, snapshot, operation);
}

/** Build the workspace-scoped SSE URL; a lost cursor reconnects cleanly. */
export function buildProjectionEventsUrl(
  base: string,
  input: { workspaceId: string; citySlug: string; mode: string; cursor: string | null },
): string {
  const params = new URLSearchParams({ citySlug: input.citySlug, mode: input.mode });
  if (input.cursor !== null) params.set("cursor", input.cursor);
  return `${base}/api/v1/workspaces/${input.workspaceId}/signal-facets/projection-events?${params}`;
}
