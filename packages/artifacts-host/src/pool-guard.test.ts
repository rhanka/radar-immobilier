import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type pg from "pg";
import { guardArtifactPool } from "./idempotency.js";

class FakeClient extends EventEmitter {
  readonly releaseSpy = vi.fn();
  release = this.releaseSpy;
}

function fakePool(client: FakeClient) {
  return {
    on: vi.fn(),
    listenerCount: () => 0,
    connect: async () => client,
  } as unknown as pg.Pool;
}

describe("guardArtifactPool", () => {
  it("adds an idle error handler once", async () => {
    const client = new FakeClient();
    const raw = fakePool(client);
    const pool = guardArtifactPool(raw);
    guardArtifactPool(pool);
    expect((raw.on as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("releases a broken reserved client with an error", async () => {
    const client = new FakeClient();
    const pool = guardArtifactPool(fakePool(client));
    const reserved = await pool.connect();
    reserved.emit("error", new Error("terminating connection"));
    reserved.release();
    expect(client.releaseSpy).toHaveBeenCalledTimes(1);
    expect(client.releaseSpy.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(client.listenerCount("error")).toBe(0);
  });

  it("releases a healthy client without an error", async () => {
    const client = new FakeClient();
    const pool = guardArtifactPool(fakePool(client));
    const reserved = await pool.connect();
    reserved.release();
    expect(client.releaseSpy).toHaveBeenCalledTimes(1);
    expect(client.releaseSpy.mock.calls[0]?.[0]).toBeUndefined();
  });

  it("guards callback acquisitions used by pool.query", async () => {
    const client = new FakeClient();
    const raw = { on: vi.fn(), connect: (callback: (...args: unknown[]) => void) => {
      callback(undefined, client, client.release);
    } } as unknown as pg.Pool;
    const pool = guardArtifactPool(raw);
    await new Promise<void>((resolve, reject) => pool.connect((error, reserved, release) => {
      if (error || !reserved) return reject(error ?? new Error("missing reserved client"));
      reserved.emit("error", new Error("connection terminated"));
      release();
      resolve();
    }));
    expect(client.releaseSpy.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it("preserves a delegating pool connect getter", async () => {
    const client = new FakeClient();
    const raw = fakePool(client);
    const connect = raw.connect;
    const delegated = new Proxy(raw, { get(target, key) {
      if (key === "connect") return () => target.connect();
      return Reflect.get(target, key, target);
    } });
    const pool = guardArtifactPool(delegated);
    expect(raw.connect).toBe(connect);
    const reserved = await pool.connect();
    reserved.emit("error", new Error("connection terminated"));
    reserved.release();
    expect(client.releaseSpy.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });
});
