import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../db/client.js";
import { ScopeError } from "../services/facets/scope.js";
import { scopedProjectionEventsRoute } from "./scoped-projection-events.js";
import { pollProjectionInvalidation } from "../services/facets/projection-invalidation.js";

vi.mock("../services/facets/projection-invalidation.js", async (original) => ({
  ...await original<typeof import("../services/facets/projection-invalidation.js")>(),
  pollProjectionInvalidation: vi.fn(),
}));
const poll = vi.mocked(pollProjectionInvalidation);
const scope = { token: "synthetic-token", personalRevision: 0, workspaceRevision: 0,
  sourceRevision: 0, sourceDigest: "", membershipRevision: 1 };
const url = "/api/v1/workspaces/11111111-1111-4111-8111-111111111111/signal-facets/projection-events?citySlug=synthetic&mode=signal";
function appFor(session: object, now = () => 1000) {
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("session" as never, session as never); await next(); });
  app.route("/", scopedProjectionEventsRoute({ db: {} as Database, auth: { enabled: true },
    watchIntervalMs: 100, now }));
  return app;
}
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });
describe("6L2 credential and connection lifecycle", () => {
  it("should refuse bearer and missing expiration credentials before polling", async () => {
    expect((await appFor({ sub: "synthetic", via: "bearer" }).request(url)).status).toBe(403);
    expect((await appFor({ sub: "synthetic" }).request(url)).status).toBe(401);
    expect(poll).not.toHaveBeenCalled();
  });
  it("should check credentials again after an awaited authorization read", async () => {
    let now = 1000;
    poll.mockImplementation(async () => { now = 2000; return scope; });
    expect((await appFor({ sub: "synthetic", exp: 2 }, () => now).request(url)).status).toBe(401);
  });
  it("should recheck expiration immediately before emitting the first frame", async () => {
    vi.useFakeTimers();
    let checks = 0;
    poll.mockResolvedValue(scope);
    const response = await appFor({ sub: "synthetic", exp: 2 }, () => ++checks >= 3 ? 2000 : 1000).request(url);
    const reader = response.body!.getReader();
    try {
      const body = new TextDecoder().decode((await reader.read()).value);
      expect(body).toContain("event: closed");
      expect(body).not.toContain("event: resync");
      expect(vi.getTimerCount()).toBe(0);
    } finally { await reader.cancel(); }
  });
  it("should serialize slow cycles and discard completion after cancellation", async () => {
    vi.useFakeTimers();
    let resolve!: (value: typeof scope) => void;
    poll.mockResolvedValueOnce(scope).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const response = await appFor({ sub: "synthetic", exp: 2 }).request(url);
    const reader = response.body!.getReader();
    await reader.read();
    await vi.advanceTimersByTimeAsync(400);
    expect(poll).toHaveBeenCalledTimes(2);
    await reader.cancel();
    resolve({ ...scope, token: "changed" });
    await vi.advanceTimersByTimeAsync(400);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("should recover after temporary unavailability without exposing internal errors", async () => {
    vi.useFakeTimers();
    poll.mockResolvedValueOnce(scope).mockRejectedValueOnce(new Error("internal-db-secret"))
      .mockResolvedValue({ ...scope, token: "changed" });
    const response = await appFor({ sub: "synthetic", exp: 2 }).request(url);
    const reader = response.body!.getReader();
    try {
      await reader.read();
      await vi.advanceTimersByTimeAsync(100);
      const unavailable = new TextDecoder().decode((await reader.read()).value);
      expect(unavailable).toContain("event: unavailable");
      expect(unavailable).not.toContain("internal-db-secret");
      await vi.advanceTimersByTimeAsync(100);
      expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: invalidated");
    } finally { await reader.cancel(); }
  });
  it("should close denied cycles before any token emission", async () => {
    vi.useFakeTimers();
    poll.mockResolvedValueOnce(scope).mockRejectedValue(new ScopeError(403, "revoked"));
    const reader = (await appFor({ sub: "synthetic", exp: 2 }).request(url)).body!.getReader();
    await reader.read();
    await vi.advanceTimersByTimeAsync(100);
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: closed");
    expect((await reader.read()).done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
