import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import { classFeedbackRoute } from "./class-feedback.js";

const workspace = "00000000-0000-4000-8000-000000000001";
function app(session?: { sub: string; via?: string }, enabled = true) {
  const route = new Hono();
  if (session) route.use("*", async (c, next) => { c.set("session" as never, session as never); await next(); });
  route.route("/", classFeedbackRoute({ db: {} as Database, auth: { enabled } }));
  return route;
}
describe("class feedback HTTP guards", () => {
  it("should refuse missing sessions and disabled authentication", async () => {
    const path = `/api/v1/workspaces/${workspace}/signal-facets/class-feedback`;
    expect((await app().request(path, { method: "POST" })).status).toBe(401);
    expect((await app({ sub: "actor" }, false).request(path, { method: "POST" })).status).toBe(401);
  });
  it("should require a browser session and valid workspace before mutation", async () => {
    const path = `/api/v1/workspaces/${workspace}/signal-facets/class-feedback`;
    expect((await app({ sub: "actor", via: "bearer" }).request(path, { method: "POST" })).status).toBe(403);
    expect((await app({ sub: "actor" }).request(path.replace(workspace, "invalid"), { method: "POST" })).status).toBe(400);
  });
  it("should reject incomplete negative feedback before accessing the database", async () => {
    const response = await app({ sub: "actor" }).request(`/api/v1/workspaces/${workspace}/signal-facets/class-feedback`, {
      method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": workspace },
      body: JSON.stringify({ verdict: "down" }),
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
});
