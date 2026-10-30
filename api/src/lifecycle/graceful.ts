/**
 * Graceful stop for the blue/green cutover: on SIGTERM the server stops accepting connections,
 * closes Server-Sent Event streams (EventSource reconnects through the switched Service) and
 * waits for in-flight requests, bounded by the Pod termination grace period.
 */
import type { MiddlewareHandler } from "hono";

export interface Closable {
  close(callback?: (error?: Error) => void): unknown;
}

export interface Graceful {
  middleware: MiddlewareHandler;
  inflight(): number;
  streams(): number;
  shutdown(server: Closable, timeoutMs?: number): Promise<"drained" | "timeout">;
}

export function createGraceful(): Graceful {
  let inflight = 0;
  let draining = false;
  const closers = new Set<() => void>();
  const idle = new Set<() => void>();
  const settle = () => {
    if (inflight === 0) for (const resolve of idle) resolve();
  };

  const middleware: MiddlewareHandler = async (c, next) => {
    inflight += 1;
    try {
      await next();
    } finally {
      inflight -= 1;
      settle();
    }
    const type = c.res.headers.get("content-type") ?? "";
    const body = c.res.body;
    if (!type.startsWith("text/event-stream") || !body) return;
    // Long-lived stream: tracked apart from in-flight requests and closed at shutdown.
    const reader = body.getReader();
    let close = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        close = () => {
          closers.delete(close);
          void reader.cancel().catch(() => {});
          try { controller.close(); } catch { /* already closed */ }
        };
        closers.add(close);
        if (draining) close();
      },
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            closers.delete(close);
            controller.close();
          } else controller.enqueue(value);
        } catch {
          closers.delete(close);
          try { controller.close(); } catch { /* already closed */ }
        }
      },
      cancel() {
        closers.delete(close);
        return reader.cancel();
      },
    });
    c.res = new Response(stream, c.res);
  };

  async function shutdown(server: Closable, timeoutMs = 25_000): Promise<"drained" | "timeout"> {
    draining = true;
    server.close();
    for (const close of [...closers]) close();
    if (inflight === 0) return "drained";
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        idle.delete(done);
        resolve("drained");
      };
      const timer = setTimeout(() => {
        idle.delete(done);
        resolve("timeout");
      }, timeoutMs);
      idle.add(done);
    });
  }

  return { middleware, inflight: () => inflight, streams: () => closers.size, shutdown };
}
