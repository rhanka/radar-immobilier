import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { EventEmitter } from "node:events";
import { handleAppError, instrumentPool, isMaintenanceError, maintenanceGuard } from "./maintenance.js";

function appThrowing(error: unknown): Hono {
  const app = new Hono();
  app.onError(handleAppError);
  app.post("/write", () => { throw error; });
  return app;
}

describe("cutover freeze errors", () => {
  it("maps read-only (25006) and terminated (57P01) sessions to an explicit 503, through a cause chain", async () => {
    for (const code of ["25006", "57P01"]) {
      const wrapped = new Error("Failed query", { cause: Object.assign(new Error("db"), { code }) });
      expect(isMaintenanceError(wrapped)).toBe(true);
      const res = await appThrowing(wrapped).request("/write", { method: "POST" });
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("5");
      expect(await res.json()).toEqual({ error: "maintenance_read_only" });
    }
  });

  it("keeps other errors as 500 and HTTP exceptions as their own response", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const other = await appThrowing(Object.assign(new Error("unique"), { code: "23505" })).request("/write", { method: "POST" });
    expect(other.status).toBe(500);
    quiet.mockRestore();
    const http = await appThrowing(new HTTPException(409, { message: "conflict" })).request("/write", { method: "POST" });
    expect(http.status).toBe(409);
  });
});

class FakeClient extends EventEmitter {
  readonly fail: () => unknown;
  constructor(fail: () => unknown) { super(); this.fail = fail; }
  query(...args: unknown[]): unknown {
    const callback = args.at(-1);
    if (typeof callback === "function") { setTimeout(() => callback(this.fail(), undefined), 1); return undefined; }
    return Promise.reject(this.fail());
  }
}
const frozen = () => Object.assign(new Error("cannot execute INSERT in a read-only transaction"), { code: "25006" });

describe("freeze-safe pool", () => {
  it("keeps an error listener on every checked-out client: a terminated session never crashes the process", () => {
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pool = new FakeClient(frozen);
    instrumentPool(pool);
    const client = new FakeClient(frozen);
    pool.emit("connect", client);
    expect(client.listenerCount("error")).toBeGreaterThan(0);
    expect(() => client.emit("error", Object.assign(new Error("terminating connection"), { code: "57P01" }))).not.toThrow();
    expect(() => pool.emit("error", new Error("idle client lost"))).not.toThrow();
    quiet.mockRestore();
  });

  it("turns the 500 of a route that catches a freeze error itself into 503 maintenance_read_only", async () => {
    const pool = new FakeClient(frozen);
    instrumentPool(pool);
    const client = new FakeClient(frozen);
    pool.emit("connect", client);
    const app = new Hono();
    app.use("*", maintenanceGuard);
    app.post("/promise", async (c) => {
      try { await pool.query("INSERT INTO t VALUES (1)"); } catch { return c.json({ error: "failed" }, 500); }
      return c.json({ ok: true });
    });
    app.post("/callback", async (c) => {
      const failed = await new Promise<boolean>((resolve) => client.query("INSERT", [], (error: unknown) => resolve(Boolean(error))));
      return failed ? c.json({ error: "failed" }, 500) : c.json({ ok: true });
    });
    app.post("/other", async (c) => c.json({ error: "failed" }, 500));
    for (const path of ["/promise", "/callback"]) {
      const res = await app.request(path, { method: "POST" });
      expect(res.status, path).toBe(503);
      expect(res.headers.get("retry-after")).toBe("5");
      expect(await res.json()).toEqual({ error: "maintenance_read_only" });
    }
    expect((await app.request("/other", { method: "POST" })).status).toBe(500);
  });
});
