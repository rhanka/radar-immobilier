import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { liveHostRoute } from "./live-host-route.js";

const endpoints = {
  job: vi.fn(async (body: unknown) => ({ status: 200, body: { v: 1, job: { echo: body } } })),
  handoff: vi.fn(async () => ({ status: 409, body: { v: 1, error: "handoff_replayed" } })),
};
const app = new Hono().route("/api/v1/artifacts", liveHostRoute(endpoints as never));

describe("inbound live-host routes", () => {
  it("serves POST /api/v1/artifacts/live-host/v1/job and /handoff with the endpoint answers", async () => {
    const job = await app.request("/api/v1/artifacts/live-host/v1/job", { method: "POST", body: JSON.stringify({ claims: { a: 1 } }) });
    expect(job.status).toBe(200);
    expect(await job.json()).toEqual({ v: 1, job: { echo: { claims: { a: 1 } } } });
    expect(job.headers.get("cache-control")).toBe("no-store");
    const handoff = await app.request("/api/v1/artifacts/live-host/v1/handoff", { method: "POST", body: "{}" });
    expect(handoff.status).toBe(409);
    expect(await handoff.json()).toEqual({ v: 1, error: "handoff_replayed" });
  });

  it("passes malformed JSON as undefined and refuses an oversized job request", async () => {
    await app.request("/api/v1/artifacts/live-host/v1/job", { method: "POST", body: "not json" });
    expect(endpoints.job).toHaveBeenLastCalledWith(undefined);
    const big = await app.request("/api/v1/artifacts/live-host/v1/job", { method: "POST", body: "x".repeat(9000),
      headers: { "content-length": "9000" } });
    expect(big.status).toBe(413);
  });

  it("does not serve other methods or paths", async () => {
    expect((await app.request("/api/v1/artifacts/live-host/v1/job")).status).toBe(404);
    expect((await app.request("/api/v1/artifacts/live-host/v1/other", { method: "POST", body: "{}" })).status).toBe(404);
  });
});
