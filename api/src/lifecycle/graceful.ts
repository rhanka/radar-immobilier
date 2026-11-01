/**
 * Graceful stop for the blue/green cutover: on SIGTERM the server stops accepting connections,
 * closes Server-Sent Event streams (EventSource reconnects through the switched Service) and
 * waits for in-flight requests, bounded by the Pod termination grace period.
 */
import type { MiddlewareHandler } from "hono";

export interface Closable {
  close(callback?: (error?: Error) => void): unknown;
  /** Node HTTP servers: drop idle keep-alive sockets once the last response is sent. */
  closeIdleConnections?(): void;
}

/** The Node response behind a request (@hono/node-server bindings), when served over HTTP. */
interface Outgoing {
  writableFinished?: boolean;
  destroyed?: boolean;
  once(event: "finish" | "close", listener: () => void): unknown;
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
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      inflight -= 1;
      settle();
    };
    try {
      await next();
    } catch (error) {
      release();
      throw error;
    }
    const type = c.res.headers.get("content-type") ?? "";
    const body = c.res.body;
    const stream = type.startsWith("text/event-stream") && body;
    // A request stays in flight until its response is written to the socket (or the socket
    // closes), not when the handler returns: the SIGTERM exit never cuts an acknowledged write.
    const outgoing = (c.env as { outgoing?: Outgoing } | undefined)?.outgoing;
    if (!stream && outgoing && typeof outgoing.once === "function" && !outgoing.writableFinished && !outgoing.destroyed) {
      outgoing.once("finish", release);
      outgoing.once("close", release);
    } else release();
    if (!stream) return;
    // Long-lived stream: tracked apart from in-flight requests and closed at shutdown.
    const reader = stream.getReader();
    let close = () => {};
    const tracked = new ReadableStream<Uint8Array>({
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
    c.res = new Response(tracked, c.res);
  };

  async function shutdown(server: Closable, timeoutMs = 25_000): Promise<"drained" | "timeout"> {
    draining = true;
    // The close callback fires once every connection has ended: awaited, within the same bound.
    const closed = new Promise<void>((resolve) => {
      try {
        server.close(() => resolve());
      } catch {
        resolve();
      }
    });
    for (const close of [...closers]) close();
    let onIdle = () => {};
    const drained = new Promise<void>((resolve) => {
      onIdle = () => {
        idle.delete(onIdle);
        resolve();
      };
      if (inflight === 0) resolve();
      else idle.add(onIdle);
    }).then(() => server.closeIdleConnections?.());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    const outcome = await Promise.race([Promise.all([drained, closed]).then(() => "drained" as const), timeout]);
    clearTimeout(timer);
    idle.delete(onIdle);
    return outcome;
  }

  return { middleware, inflight: () => inflight, streams: () => closers.size, shutdown };
}
