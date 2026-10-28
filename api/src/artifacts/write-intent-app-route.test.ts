// PW-A PWA-08b/c: app routes refuse bearer, enforce origin, stay closed.
import { describe, expect, it } from "vitest";
import { writeIntentAppRoute } from "./write-intent-app-route.js";
import { Hono } from "hono";

describe("write app routes", () => {
  it("should stay closed without domain and reject wrong methods", async () => {
    const app = writeIntentAppRoute(null);
    expect((await app.request("/api/v1/artifacts/write-intents/x/confirm", { method: "POST" })).status).toBe(503);
    expect((await app.request("/api/v1/artifacts/write-intents/x/confirm", { method: "GET" })).status).toBe(405);
    expect((await app.request("/api/v1/artifacts/write-intents/x/revoke", { method: "GET" })).status).toBe(405);
  });

  it("should preserve unrelated application routes when PW is closed", async () => {
    const app = new Hono();
    app.route("/", writeIntentAppRoute(null));
    app.get("/api/v1/auth/me", (c) => c.json({ reachable: true }));
    const response = await app.request("/api/v1/auth/me");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reachable: true });
    for (const path of ["/artifact-write/intents/x", "/api/v1/artifacts/write-intents/x/confirm"]) {
      const res = await app.request(path, { method: path.endsWith("confirm") ? "POST" : "GET" });
      expect(res.status).toBe(503);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
      expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    }
  });
});
