import type { S3Client } from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";

export const S3_OPERATION_TIMEOUT_MS = 5000;

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

export function createTimeoutBlobStore<T extends object>(
  inner: T, timeoutMs = S3_OPERATION_TIMEOUT_MS,
): T {
  return new Proxy(inner, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const result = (value as (...args: unknown[]) => unknown).apply(target, args);
        if (property !== "destroy" && property !== "close" && result instanceof Promise) {
          return withS3Timeout(result, `blobs.${String(property)}`, timeoutMs);
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
