import type { LiveRedriveItem } from "@sentropic/artifacts";

/**
 * Host timer of the 0.2.27 durable live re-drive (`LiveSessionService.redrive`).
 *
 * The builder answers `POST v1/live/reconcile` within its live wait and keeps
 * reviving behind `ready: false`; a settle can also be lost with its process.
 * The package re-drive settles again every runtime of the scope that still
 * waits for the worker (REVIVING, LIVE behind its draft, a stop not DORMANT
 * yet), at most 4 items in flight, each abandoned after 35 s. The host runs one
 * pass at boot and one every 15 s, so a start waits at most 15 s + 35 s < 60 s
 * for its next settle, even after a pod restart (causes A1, A3, A9).
 *
 * SIGTERM stops the timer and drains the pass in flight (bounded under the
 * default 30 s pod grace); a drained pass leaves every unsettled intent
 * durable, and the next pod re-drives it. When no other SIGTERM listener
 * remains, the signal is raised again so the default termination applies.
 */
export const LIVE_REDRIVE_INTERVAL_MS = 15_000;
export const LIVE_REDRIVE_DRAIN_MS = 25_000;

export interface ShutdownSignals {
  once(signal: "SIGTERM", listener: () => void): unknown;
  removeListener(signal: "SIGTERM", listener: () => void): unknown;
  listenerCount(signal: "SIGTERM"): number;
  kill(pid: number, signal: "SIGTERM"): unknown;
  readonly pid: number;
}

export interface LiveRedriveLoopOptions {
  readonly redrive: () => Promise<readonly LiveRedriveItem[]>;
  readonly intervalMs?: number;
  readonly drainTimeoutMs?: number;
  readonly signals?: ShutdownSignals;
  readonly log?: (line: string) => void;
  readonly onError?: (error: unknown) => void;
}

export interface LiveRedriveLoop {
  /** Stops the timer and waits for the pass in flight, at most `drainTimeoutMs`. */
  drain(): Promise<void>;
  /** Stops the timer and removes the SIGTERM handler (host close). */
  stop(): void;
}

export function startLiveRedriveLoop(options: LiveRedriveLoopOptions): LiveRedriveLoop {
  const log = options.log ?? ((line: string) => console.error(line));
  const signals = options.signals ?? process;
  let inFlight: Promise<void> | undefined;
  let stopped = false;
  const pass = () => {
    if (stopped || inFlight) return;
    inFlight = options.redrive()
      .then((items) => {
        if (items.length === 0) return;
        const count = (outcome: LiveRedriveItem["outcome"]) => items.filter((item) => item.outcome === outcome).length;
        log(JSON.stringify({ kind: "artifacts.live_redrive", items: items.length, settled: count("settled"),
          pending: count("pending"), failed: count("failed"), skipped: count("skipped") }));
      })
      .catch((error: unknown) => {
        log(JSON.stringify({ kind: "artifacts.live_redrive_unavailable" }));
        options.onError?.(error);
      })
      .finally(() => { inFlight = undefined; });
  };
  const timer = setInterval(pass, options.intervalMs ?? LIVE_REDRIVE_INTERVAL_MS);
  timer.unref();
  const halt = () => { stopped = true; clearInterval(timer); };
  const drain = async () => {
    halt();
    const current = inFlight;
    if (!current) return;
    let deadline: NodeJS.Timeout | undefined;
    await Promise.race([current, new Promise<void>((resolve) => {
      deadline = setTimeout(resolve, options.drainTimeoutMs ?? LIVE_REDRIVE_DRAIN_MS);
    })]);
    clearTimeout(deadline);
  };
  const onSigterm = () => {
    log(JSON.stringify({ kind: "artifacts.live_redrive_draining" }));
    void drain().finally(() => {
      if (signals.listenerCount("SIGTERM") === 0) signals.kill(signals.pid, "SIGTERM");
    });
  };
  signals.once("SIGTERM", onSigterm);
  pass();
  return { drain, stop() { halt(); signals.removeListener("SIGTERM", onSigterm); } };
}
