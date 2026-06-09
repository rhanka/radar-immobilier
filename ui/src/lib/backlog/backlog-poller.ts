// WP6 — Backlog live poller.
//
// Drives the Backlog view's LIVE refresh from the real track sidecar. The view
// fetches `GET /api/backlog` once on mount today; this controller turns that
// into a light, pausable poll so newly-tracked items (added as work progresses)
// surface without a manual reload.
//
// Design:
//  - **Framework-agnostic + injectable**: `fetchBacklog`, `now` and `intervalMs`
//    are injected so the polling logic is unit-tested with fake timers and a
//    stub fetch (no DOM, no real clock). The Svelte view wires the real client.
//  - **No thrash**: one timer at a time, cleared on `stop()`; overlapping polls
//    are skipped (a tick that lands while a fetch is in flight is ignored).
//  - **Never blanks**: on a failed poll the controller keeps the last good items
//    and flags the source as the ÉV fallback, mirroring the view's existing
//    offline behaviour, so the board never empties mid-refresh.
//  - **Pausable**: `pause()` stops ticks (e.g. tab hidden / user toggle),
//    `resume()` restarts them; `refresh()` is an out-of-band manual poll.

import type { BacklogResponse } from "./backlog-client.js";
import { backlogSeed } from "./backlog-data.js";
import type { BacklogItem, BacklogSource } from "./backlog-data.js";

/** Default poll cadence (ms). Kept light to avoid request thrash. */
export const DEFAULT_BACKLOG_POLL_MS = 10_000;

/** Reactive state surfaced to the view on every transition. */
export interface BacklogPollerState {
  /** Items currently displayed (live track, runtime requests, or ÉV fallback). */
  items: BacklogItem[];
  /** Provenance of the displayed items. */
  source: BacklogSource;
  /** True while a poll is in flight (first load / manual refresh). */
  loading: boolean;
  /** Epoch ms of the last SUCCESSFUL poll, or null before the first success. */
  lastUpdated: number | null;
  /** Last poll error message, or null when the last poll succeeded. */
  error: string | null;
  /** Whether the interval is paused. */
  paused: boolean;
}

/** Injected dependencies (all optional except the fetcher in production wiring). */
export interface BacklogPollerDeps {
  /** Fetches the backlog (defaults to the real client in the view). */
  fetchBacklog: () => Promise<BacklogResponse>;
  /** Poll cadence in ms (default `DEFAULT_BACKLOG_POLL_MS`). */
  intervalMs?: number;
  /** Clock source (default `Date.now`); injectable for deterministic tests. */
  now?: () => number;
}

/** Subscriber callback; receives the latest immutable-ish state snapshot. */
export type BacklogPollerListener = (state: BacklogPollerState) => void;

/** A running backlog poller. */
export interface BacklogPoller {
  /** Current state (synchronous read). */
  getState(): BacklogPollerState;
  /** Subscribe to state transitions; returns an unsubscribe fn. */
  subscribe(listener: BacklogPollerListener): () => void;
  /** Start polling: fetch immediately, then on each interval tick. */
  start(): void;
  /** Stop polling and clear the timer (call on unmount). */
  stop(): void;
  /** Pause ticks (keeps state); `resume()` to restart. */
  pause(): void;
  /** Resume ticks after a pause. */
  resume(): void;
  /** Trigger an out-of-band poll now (e.g. the "Actualiser" button). */
  refresh(): Promise<void>;
}

export function createBacklogPoller(deps: BacklogPollerDeps): BacklogPoller {
  const intervalMs = deps.intervalMs ?? DEFAULT_BACKLOG_POLL_MS;
  const now = deps.now ?? Date.now;

  let state: BacklogPollerState = {
    items: [...backlogSeed],
    source: "ev-fallback",
    loading: false,
    lastUpdated: null,
    error: null,
    paused: false,
  };

  const listeners = new Set<BacklogPollerListener>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;

  function emit(): void {
    for (const listener of listeners) listener(state);
  }

  function setState(patch: Partial<BacklogPollerState>): void {
    state = { ...state, ...patch };
    emit();
  }

  async function poll(): Promise<void> {
    // Skip overlapping polls: a tick during an in-flight fetch is a no-op.
    if (inFlight) return;
    inFlight = true;
    setState({ loading: true });
    try {
      const res = await deps.fetchBacklog();
      setState({
        items: res.items,
        source: res.source,
        loading: false,
        lastUpdated: now(),
        error: null,
      });
    } catch (err) {
      // Keep the last good items so the board never blanks; flag the fallback.
      setState({
        loading: false,
        source: "ev-fallback",
        error: err instanceof Error ? err.message : "backlog refresh failed",
      });
    } finally {
      inFlight = false;
    }
  }

  function arm(): void {
    if (timer !== null) return;
    timer = setInterval(() => {
      void poll();
    }, intervalMs);
  }

  function disarm(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    start() {
      void poll();
      if (!state.paused) arm();
    },
    stop() {
      disarm();
    },
    pause() {
      disarm();
      setState({ paused: true });
    },
    resume() {
      setState({ paused: false });
      arm();
    },
    async refresh() {
      await poll();
    },
  };
}
