import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createGraceful } from "./graceful.js";

const server = () => {
  const state = { closed: false };
  return { state, close: (callback?: () => void) => { state.closed = true; callback?.(); } };
};

describe("graceful stop", () => {
  it("closes SSE streams at SIGTERM and waits for in-flight requests", async () => {
    const graceful = createGraceful();
    const app = new Hono();
    app.use("*", graceful.middleware);
    let release: () => void = () => {};
    app.get("/slow", async (c) => {
      await new Promise<void>((resolve) => { release = resolve; });
      return c.json({ ok: true });
    });
    app.get("/events", (c) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new TextEncoder().encode("data: ready\n\n")); },
      });
      c.header("Content-Type", "text/event-stream; charset=utf-8");
      return c.body(stream);
    });

    const events = await app.request("/events");
    const reader = events.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("ready");
    expect(graceful.streams()).toBe(1);

    const slow = app.request("/slow");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(graceful.inflight()).toBe(1);

    const s = server();
    let outcome: string | undefined;
    const stopping = graceful.shutdown(s, 2_000).then((o) => { outcome = o; });
    expect(s.state.closed).toBe(true);
    expect((await reader.read()).done).toBe(true);
    expect(graceful.streams()).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(outcome).toBeUndefined();
    release();
    expect((await slow).status).toBe(200);
    await stopping;
    expect(outcome).toBe("drained");
  });

  it("gives up after the bound when a request never ends", async () => {
    const graceful = createGraceful();
    const app = new Hono();
    app.use("*", graceful.middleware);
    app.get("/stuck", () => new Promise<Response>(() => {}));
    void app.request("/stuck");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await graceful.shutdown(server(), 50)).toBe("timeout");
  });

  it("keeps a request in flight until its response is written, not when the handler returns", async () => {
    const graceful = createGraceful();
    const app = new Hono();
    app.use("*", graceful.middleware);
    app.post("/write", (c) => c.json({ ok: true }));
    // The Node response of @hono/node-server: the body is written after the handler returned.
    const outgoing = Object.assign(new EventEmitter(), { writableFinished: false });
    const response = await app.request("/write", { method: "POST" }, { outgoing });
    expect(response.status).toBe(200);
    expect(graceful.inflight()).toBe(1);
    let outcome: string | undefined;
    const stopping = graceful.shutdown(server(), 2_000).then((o) => { outcome = o; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(outcome).toBeUndefined();
    outgoing.writableFinished = true;
    outgoing.emit("finish");
    await stopping;
    expect(outcome).toBe("drained");
    expect(graceful.inflight()).toBe(0);
  });

  it("waits for the server close callback before reporting drained, within the bound", async () => {
    const graceful = createGraceful();
    let closed: () => void = () => {};
    const pending = { close: (callback?: () => void) => { closed = callback ?? (() => {}); } };
    let outcome: string | undefined;
    const stopping = graceful.shutdown(pending, 2_000).then((o) => { outcome = o; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(outcome).toBeUndefined();
    closed();
    await stopping;
    expect(outcome).toBe("drained");
    expect(await graceful.shutdown({ close: () => {} }, 50)).toBe("timeout");
  });
});
