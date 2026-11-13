import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { signalMcpRoute } from "./signal-mcp.js";
import { readSignalMcp, addSignalNote } from "../services/graph/signal-mcp.js";
import type { Database } from "../db/client.js";
vi.mock("../services/graph/signal-mcp.js", () => ({ readSignalMcp: vi.fn(), addSignalNote: vi.fn() }));
const path = "/api/v1/workspaces/10000000-0000-4000-8000-000000000001/signal-facets/annotations";
function app(session?: { sub: string; via?: string }) {
  const app = new Hono();
  app.use("*", async (c, next) => { if (session) c.set("session" as never, session as never); await next(); });
  app.route("/", signalMcpRoute({ db: {} as Database, auth: { enabled: true } }));
  return app;
}
describe("signal note browser boundary", () => {
  it("should require a browser session and never accept MCP validation claims", async () => {
    expect((await app().request(path)).status).toBe(401);
    expect((await app({ sub: "viewer", via: "bearer" }).request(path)).status).toBe(403);
    const response = await app({ sub: "viewer" }).request(path, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: { scope: "personal", citySlug: "city", type: "Signal", id: "one" },
        text: "note", version: "a".repeat(32), source: "mcp", validation: "human" }) });
    expect(response.status).toBe(400);
    expect(addSignalNote).not.toHaveBeenCalled();
  });
  it("should preserve workspace denials and private cache headers", async () => {
    vi.mocked(readSignalMcp).mockResolvedValue({ error: "workspace_membership_required" } as never);
    const response = await app({ sub: "viewer" }).request(`${path}?scope=personal&citySlug=city&type=Signal&id=one`);
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
