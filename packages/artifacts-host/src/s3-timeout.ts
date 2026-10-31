import type { S3Client } from "@aws-sdk/client-s3";
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
 * retriable 503.
 */
export interface ArtifactS3Budget {
  /** One HTTP attempt: handshake, request and response headers (SDK requestTimeout). */
  readonly attemptTimeoutMs: number;
  /** SDK attempts per S3 call; timeouts, network errors and 5xx are retried, 4xx are not. */
  readonly maxAttempts: number;
  /** Whole blob operation, every attempt and backoff included (host deadline). */
  readonly operationTimeoutMs: number;
}

/** Room for the SDK backoff between attempts (standard mode: under 600 ms for 3 attempts). */
export const S3_RETRY_HEADROOM_MS = 1000;

/**
 * 3 x 4 s keeps a blob PUT plus its read-back under the 30 s preparation cleanup
 * window, even when both need every attempt.
 */
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
        const result = (value as (...args: unknown[]) => unknown).apply(target, args);
        if (property !== "destroy" && property !== "close" && result instanceof Promise) {
          const bounded = withS3Timeout(result, `blobs.${String(property)}`, timeoutMs);
          if (onFailure === undefined) return bounded;
          return bounded.catch((error: unknown) => { safeReport(onFailure, error); throw error; });
        }
        return result;
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
        const timer = setTimeout(() => abort(new ArtifactS3TimeoutError("s3.send", timeoutMs)), timeoutMs);
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
