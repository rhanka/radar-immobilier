import type { S3Client } from "@aws-sdk/client-s3";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Readable } from "node:stream";

/**
 * Time budget of one blob operation against the provider.
 *
 * A single HTTP attempt can stall before any byte comes back. Measured on
 * 2026-10-31 from the preprod MCP pod and from outside the cluster, 5-10 % of
 * fresh TLS connections to s3.bhs.io.cloud.ovh.net took 5-16 s to handshake or
 * never completed, while DNS (< 10 ms) and TCP connect (~1 ms) stayed fast and
 * other S3 endpoints handshook in < 100 ms; requests then take 0.3-2.6 s. The
 * SDK retries a stalled attempt on a new connection, so the operation deadline
 * must leave room for the retries; it is still the bound that maps to a
 * retriable 503. A publish runs several operations in sequence: they also
 * share one invocation deadline (withS3Deadline) below the preparation window.
 */
export interface ArtifactS3Budget {
  /** One HTTP attempt: handshake, request and response headers (SDK requestTimeout). */
  readonly attemptTimeoutMs: number;
  /**
   * SDK attempts per S3 call (standard mode). Retried: timeouts, network errors,
   * 5xx, throttling (429, SlowDown) and S3 RequestTimeout (400). Not retried:
   * the other 4xx answers (403, 404, ...).
   */
  readonly maxAttempts: number;
  /** Whole blob operation, every attempt and backoff included (host deadline). */
  readonly operationTimeoutMs: number;
}

/**
 * Room for the SDK backoff between attempts: under 600 ms over 3 attempts for
 * transient errors. Throttling backs off longer (up to 3 s); the operation
 * deadline still bounds it and maps to a retriable 503.
 */
export const S3_RETRY_HEADROOM_MS = 1000;

/** 3 attempts of 4 s: enough for a stalled handshake plus two fresh tries. */
export const DEFAULT_S3_BUDGET: ArtifactS3Budget = Object.freeze({
  attemptTimeoutMs: 4000,
  maxAttempts: 3,
  operationTimeoutMs: 3 * 4000 + S3_RETRY_HEADROOM_MS,
});

export const S3_OPERATION_TIMEOUT_MS = DEFAULT_S3_BUDGET.operationTimeoutMs;

export class ArtifactS3TimeoutError extends Error {
  readonly code = "artifact_s3_timeout";
  constructor(readonly operation = "s3", timeoutMs = S3_OPERATION_TIMEOUT_MS) {
    super(`artifact s3 operation timed out: ${operation} exceeded ${timeoutMs}ms`);
    this.name = "ArtifactS3TimeoutError";
  }
}

const invocationDeadline = new AsyncLocalStorage<number>();

/**
 * Run `work` with one absolute deadline (epoch ms) shared by every blob
 * operation it starts, on top of each operation's own budget. Per-operation
 * budgets alone do not bound a publish, which stages then reads back each file
 * in sequence.
 */
export function withS3Deadline<T>(deadlineMs: number, work: () => Promise<T>): Promise<T> {
  return invocationDeadline.run(deadlineMs, work);
}

/** Time left for one operation: its own budget, capped by the invocation deadline. */
function remainingBudget(timeoutMs: number): number {
  const deadline = invocationDeadline.getStore();
  return deadline === undefined ? timeoutMs : Math.min(timeoutMs, deadline - Date.now());
}

/** Bound complete blob operations, including injected stores and pagination. */
export function withS3Timeout<T>(
  work: Promise<T>, operation: string, timeoutMs = S3_OPERATION_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ArtifactS3TimeoutError(operation, timeoutMs)), timeoutMs);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/** Recording must never break dispatch. */
function safeReport(report: (error: unknown) => void, error: unknown): void {
  try { report(error); } catch { /* probe failure stays silent */ }
}

export function createTimeoutBlobStore<T extends object>(
  inner: T, timeoutMs = S3_OPERATION_TIMEOUT_MS,
  onFailure?: ((error: unknown) => void) | undefined,
): T {
  return new Proxy(inner, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const apply = () => (value as (...args: unknown[]) => unknown).apply(target, args);
        if (property === "destroy" || property === "close") return apply();
        const operation = `blobs.${String(property)}`;
        const budget = remainingBudget(timeoutMs);
        // Past the invocation deadline nothing new is started.
        const result = budget > 0 ? apply() : Promise.reject(new ArtifactS3TimeoutError(operation, 0));
        if (!(result instanceof Promise)) return result;
        const bounded = withS3Timeout(result, operation, Math.max(budget, 0));
        if (onFailure === undefined) return bounded;
        return bounded.catch((error: unknown) => { safeReport(onFailure, error); throw error; });
      };
    },
  });
}

type SendOptions = { readonly abortSignal?: AbortSignal | undefined } & Record<string, unknown>;
type Send = (command: unknown, options: SendOptions) => Promise<{ Body?: Readable }>;

/** Keep the deadline and caller cancellation active until the body closes. */
export function createTimeoutS3Client(
  client: S3Client, timeoutMs = S3_OPERATION_TIMEOUT_MS,
): S3Client {
  const send = (client.send as unknown as Send).bind(client);
  return new Proxy(client, {
    get(target, property) {
      if (property !== "send") {
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (command: unknown, options: SendOptions = {}) => {
        const userSignal = options.abortSignal;
        if (userSignal?.aborted) throw userSignal.reason;
        const budget = remainingBudget(timeoutMs);
        if (budget <= 0) throw new ArtifactS3TimeoutError("s3.send", 0);
        const controller = new AbortController();
        let body: Readable | undefined;
        const cleanup = () => {
          clearTimeout(timer);
          userSignal?.removeEventListener("abort", onUserAbort);
          for (const event of ["end", "close", "error"]) body?.removeListener(event, cleanup);
        };
        const abort = (reason: Error) => {
          // Destroy before aborting the request so body consumers see the typed cause.
          body?.destroy(reason);
          controller.abort(reason);
        };
        const onUserAbort = () => abort(userSignal?.reason as Error);
        const timer = setTimeout(() => abort(new ArtifactS3TimeoutError("s3.send", budget)), budget);
        userSignal?.addEventListener("abort", onUserAbort, { once: true });
        try {
          const output = await send(command, { ...options, abortSignal: controller.signal });
          body = output?.Body;
          if (body && !body.destroyed && !body.readableEnded) {
            for (const event of ["end", "close", "error"]) body.once(event, cleanup);
            if (controller.signal.aborted) body.destroy(controller.signal.reason as Error);
          } else {
            cleanup();
          }
          return output;
        } catch (error) {
          cleanup();
          throw controller.signal.aborted ? controller.signal.reason : error;
        }
      };
    },
  });
}
