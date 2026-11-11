import type { LiveStore, LiveWorkerPort } from "@sentropic/artifacts";

/**
 * Host duties on top of the package live worker (SPEC_ARTIFACT_BUILD_SLO
 * §3.4, §5.4, §6.1).
 *
 * The builder contract is a poll contract: `POST v1/live/reconcile` answers
 * within its live wait (25 s in the product builder) and a longer revive
 * answers `ready: false` while it keeps running. The package settle of
 * 0.2.25 returns on `ready: false` and swallows every worker error without
 * a log, and nothing calls reconcile again, so a session whose revive takes
 * longer than one answer stays `REVIVING` forever.
 *
 * This wrapper keeps the worker promise of an accepted command open until
 * the builder is ready, the session stops waiting, or a bound is reached:
 * - `ready: false`: reconcile again after `pollDelayMs`, up to
 *   `notReadyDeadlineMs`;
 * - a thrown refusal: retry with backoff, at most `maxFailures` consecutive
 *   failures (5 attempts over ≤ 5 min by default), then rethrow unchanged;
 * - every failure, the first pending answer, and every terminal outcome emit
 *   one structured log line; nothing is silent.
 * One poll runs per binding generation in this process: later callers join it
 * (each reconcile stages the current draft, so the ack carries the current
 * revision). The process-local poll does not survive a restart; the durable
 * re-drive of `REVIVING` records belongs to the package.
 */
export type LiveWorkerIdentity = Parameters<LiveWorkerPort["reconcile"]>[0];
export type LiveWorkerAck = Awaited<ReturnType<LiveWorkerPort["reconcile"]>>;

export interface LiveWorkerLogLine {
  readonly kind: "artifacts.live_worker_failed" | "artifacts.live_worker_pending" | "artifacts.live_worker_ready"
    | "artifacts.live_worker_abandoned";
  readonly operation: "reconcile" | "stop";
  readonly storageScopeId: string;
  readonly artifactId: string;
  readonly bindingGeneration: number;
  /** Typed code of the refusal (`provider_unavailable`, `builder_unavailable`, `git_not_attached`, …). */
  readonly code?: string;
  readonly attempt?: number;
  /** True when no further attempt follows this line. */
  readonly terminal?: boolean;
  readonly reason?: "max_failures" | "not_ready_deadline" | "session_not_waiting";
  readonly elapsedMs?: number;
  readonly polls?: number;
}

export interface LiveWorkerRedriveOptions {
  readonly log?: (line: LiveWorkerLogLine) => void;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** True while the session still waits for the builder; absent: always waiting. */
  readonly waiting?: (identity: LiveWorkerIdentity) => Promise<boolean>;
  /** Consecutive reconcile failures before the refusal is rethrown (default 5). */
  readonly maxFailures?: number;
  /** Backoff after the n-th consecutive failure (default 5 s, 15 s, 45 s, 90 s: under 5 min for 5 attempts). */
  readonly backoffMs?: (failure: number) => number;
  /** Pause between two `ready: false` answers (default 2 s; the builder itself long-polls). */
  readonly pollDelayMs?: number;
  /** Upper bound of a not-ready wait (default 45 min, the builder install ceiling). */
  readonly notReadyDeadlineMs?: number;
}

export const LIVE_WORKER_REDRIVE_DEFAULTS = Object.freeze({
  maxFailures: 5, pollDelayMs: 2_000, notReadyDeadlineMs: 45 * 60_000,
  backoffMs: (failure: number) => [5_000, 15_000, 45_000, 90_000][failure - 1] ?? 90_000,
});

const codeOf = (error: unknown): string => {
  // ArtifactOperationError carries its typed code as `kind`.
  const typed = error as { kind?: unknown; code?: unknown } | null;
  const code = typeof typed?.kind === "string" && typed.kind ? typed.kind : typed?.code;
  return typeof code === "string" && code ? code : "unknown";
};

function defaultLog(line: LiveWorkerLogLine): void {
  console.error(JSON.stringify(line));
}

/** `waiting` port on the package LiveStore: the session waits while its runtime is REVIVING, or LIVE behind its draft. */
export function liveStoreWaiting(store: LiveStore): NonNullable<LiveWorkerRedriveOptions["waiting"]> {
  return async (identity) => store.transaction(identity, async (tx) => {
    const runtime = tx.record?.runtime;
    if (!tx.record || !runtime) return false;
    return runtime.phase === "REVIVING" || (runtime.phase === "LIVE" && runtime.appliedRevision !== tx.record.revision);
  });
}

/** Logging only (no poll): for request-path callers such as the pre-build reconcile of git_publish. */
export function withLiveWorkerLogging<W extends Pick<LiveWorkerPort, "reconcile">>(inner: W,
  options: Pick<LiveWorkerRedriveOptions, "log"> = {}): W {
  const log = options.log ?? defaultLog;
  return { ...inner, async reconcile(identity: LiveWorkerIdentity) {
    try { return await inner.reconcile(identity); } catch (error) {
      log({ kind: "artifacts.live_worker_failed", operation: "reconcile", storageScopeId: identity.storageScopeId,
        artifactId: identity.artifactId, bindingGeneration: identity.bindingGeneration, code: codeOf(error), attempt: 1, terminal: true });
      throw error;
    }
  } };
}

export function createRedrivingLiveWorker(inner: LiveWorkerPort, options: LiveWorkerRedriveOptions = {}): LiveWorkerPort {
  const log = options.log ?? defaultLog;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms).unref?.(); }));
  const maxFailures = options.maxFailures ?? LIVE_WORKER_REDRIVE_DEFAULTS.maxFailures;
  const backoffMs = options.backoffMs ?? LIVE_WORKER_REDRIVE_DEFAULTS.backoffMs;
  const pollDelayMs = options.pollDelayMs ?? LIVE_WORKER_REDRIVE_DEFAULTS.pollDelayMs;
  const deadlineMs = options.notReadyDeadlineMs ?? LIVE_WORKER_REDRIVE_DEFAULTS.notReadyDeadlineMs;
  const polls = new Map<string, Promise<LiveWorkerAck>>();

  async function drive(identity: LiveWorkerIdentity): Promise<LiveWorkerAck> {
    const base = { operation: "reconcile" as const, storageScopeId: identity.storageScopeId, artifactId: identity.artifactId,
      bindingGeneration: identity.bindingGeneration };
    const startedAt = now();
    let failures = 0;
    let pending = 0;
    for (;;) {
      let ack: LiveWorkerAck;
      try {
        ack = await inner.reconcile(identity);
      } catch (error) {
        failures += 1;
        const terminal = failures >= maxFailures;
        log({ ...base, kind: "artifacts.live_worker_failed", code: codeOf(error), attempt: failures, terminal,
          ...(terminal ? { reason: "max_failures" as const } : {}), elapsedMs: now() - startedAt });
        if (terminal) throw error;
        await sleep(backoffMs(failures));
        if (options.waiting && !(await options.waiting(identity))) {
          log({ ...base, kind: "artifacts.live_worker_abandoned", terminal: true, reason: "session_not_waiting", code: codeOf(error),
            elapsedMs: now() - startedAt });
          throw error;
        }
        continue;
      }
      failures = 0;
      if (!ack || ack.ready) {
        if (pending > 0) log({ ...base, kind: "artifacts.live_worker_ready", terminal: true, polls: pending, elapsedMs: now() - startedAt });
        return ack;
      }
      pending += 1;
      if (pending === 1) log({ ...base, kind: "artifacts.live_worker_pending", polls: pending, elapsedMs: now() - startedAt });
      if (now() - startedAt >= deadlineMs) {
        log({ ...base, kind: "artifacts.live_worker_abandoned", terminal: true, reason: "not_ready_deadline", polls: pending,
          elapsedMs: now() - startedAt });
        return ack;
      }
      await sleep(pollDelayMs);
      if (options.waiting && !(await options.waiting(identity))) {
        log({ ...base, kind: "artifacts.live_worker_abandoned", terminal: true, reason: "session_not_waiting", polls: pending,
          elapsedMs: now() - startedAt });
        return ack;
      }
    }
  }

  return {
    reconcile(identity) {
      const key = JSON.stringify([identity.storageScopeId, identity.artifactId, identity.bindingGeneration]);
      const running = polls.get(key);
      if (running) return running;
      const poll = drive(identity).finally(() => { if (polls.get(key) === poll) polls.delete(key); });
      polls.set(key, poll);
      return poll;
    },
    async stop(input) {
      try { await inner.stop(input); } catch (error) {
        log({ kind: "artifacts.live_worker_failed", operation: "stop", storageScopeId: input.storageScopeId, artifactId: input.artifactId,
          bindingGeneration: input.bindingGeneration, code: codeOf(error), attempt: 1, terminal: true });
        throw error;
      }
    },
  };
}
