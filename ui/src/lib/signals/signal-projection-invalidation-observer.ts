/**
 * 6L2 invalidation observer: a gated browser SSE observer over one launched
 * invalidation sync. Dormant while the gate is closed or no workspace is
 * selected. Each event runs the 6L1 coherent fetch exactly once against the
 * live context; failures and late responses retain the last acknowledged
 * snapshot. Disposal closes the source and cancels a pending reconnect.
 */
import {
  PROJECTION_RECONNECT_DELAY_MS,
  beginInvalidationFetch,
  buildProjectionEventsUrl,
  noteInvalidationEvent,
  noteInvalidationReconciled,
  type ProjectionInvalidationContext,
  type ProjectionInvalidationSync,
  type ProjectionSnapshot,
  type StreamEvent,
} from "./signal-projection-invalidation.js";

export interface ProjectionEventSource {
  close(): void;
}

export interface ProjectionInvalidationDeps<T extends ProjectionSnapshot = ProjectionSnapshot> {
  live: () => ProjectionInvalidationContext;
  fetchCoherent: () => Promise<T>;
  rebuild: (snapshot: T) => void;
  onClosed: () => void;
  createSource: (
    url: string,
    handlers: { onEvent: (streamEvent: StreamEvent | null) => void; onError: () => void },
  ) => ProjectionEventSource;
  baseUrl?: string;
  reconnectDelayMs?: number;
  schedule?: (run: () => void, delayMs: number) => { cancel: () => void };
}

export function observeProjectionInvalidation<T extends ProjectionSnapshot = ProjectionSnapshot>(
  state: ProjectionInvalidationSync,
  deps: ProjectionInvalidationDeps<T>,
): { refresh: () => Promise<void>; dispose: () => void } {
  let disposed = false;
  let source: ProjectionEventSource | null = null;
  let pendingReconnect: { cancel: () => void } | null = null;
  let pendingRetry: { cancel: () => void } | null = null;
  let generation = 0;
  const schedule = deps.schedule ?? ((run, delayMs) => {
    const timer = setTimeout(run, delayMs);
    return { cancel: () => clearTimeout(timer) };
  });
  const closeSource = () => {
    generation += 1;
    source?.close();
    source = null;
  };
  const connect = () => {
    if (disposed || !state.enabled || state.launched.workspaceId === null) return;
    if (noteInvalidationEvent(state, deps.live(), { kind: "resync" }) === "ignore") return;
    closeSource();
    const connection = generation;
    const url = buildProjectionEventsUrl(deps.baseUrl ?? "",
      { workspaceId: state.launched.workspaceId, citySlug: state.launched.citySlug,
        mode: state.launched.mode, cursor: state.cursor });
    source = deps.createSource(url, {
      onEvent: (streamEvent) => { if (connection === generation) void wake(streamEvent); },
      onError: () => { if (connection === generation) onError(); },
    });
  };
  const onError = () => {
    if (disposed) return;
    closeSource();
    pendingReconnect?.cancel();
    pendingReconnect = schedule(connect, deps.reconnectDelayMs ?? PROJECTION_RECONNECT_DELAY_MS);
    void wake({ kind: "resync" });
  };
  const wake = async (streamEvent: StreamEvent | null): Promise<void> => {
    if (disposed) return;
    const signal = noteInvalidationEvent(state, deps.live(), streamEvent);
    if (signal === "ignore") return;
    if (signal === "closed") {
      disposed = true;
      closeSource();
      pendingReconnect?.cancel();
      pendingRetry?.cancel();
      deps.onClosed();
      return;
    }
    const operation = beginInvalidationFetch(state);
    pendingRetry?.cancel();
    let snapshot: T;
    try {
      snapshot = await deps.fetchCoherent();
    } catch (error) {
      if (disposed || operation !== state.operation) return;
      const status = (error as { status?: number } | null)?.status;
      if (status === 401 || status === 403 || status === 404) {
        await wake({ kind: "closed" });
      } else {
        pendingRetry = schedule(() => { void wake({ kind: "resync" }); }, PROJECTION_RECONNECT_DELAY_MS);
      }
      return;
    }
    if (disposed) return;
    const current = deps.live();
    if (noteInvalidationReconciled(state, current, snapshot, operation)) deps.rebuild(snapshot);
  };
  const refresh = () => wake({ kind: "resync" });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    pendingReconnect?.cancel();
    pendingRetry?.cancel();
    closeSource();
    state.operation += 1;
  };
  connect();
  return { refresh, dispose };
}
