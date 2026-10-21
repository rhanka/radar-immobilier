import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { ArtifactControl } from "@radar/artifacts-host";
import { controlRoute } from "./control-route.js";
import type { AuthConfig } from "../config.js";
import { signSession } from "../services/auth/session.js";

const AUTH: AuthConfig = {
  enabled: true, issuer: "https://auth.example.test", clientId: "radar-immobilier",
  clientSecret: "test-secret", redirectUri: "https://app.example.test/callback",
  scopes: "openid", appBaseUrl: "https://app.example.test",
  sessionSecret: "session-secret-32-bytes-long-padding!!", sessionTtlSeconds: 3600,
  sessionAbsoluteTtlSeconds: 7200, jwksUri: "https://auth.example.test/jwks",
  bearerAudiences: ["https://app.example.test"],
};

describe("private control exceptions [T29]", () => {
  it.each(["accounts", "backend"])("keeps %s exceptions private through a parent error handler", async (failure) => {
    const backend: ArtifactControl = {
      async handle() {
        if (failure === "backend") throw new Error("backend unavailable");
        return { status: 200, body: {} };
      },
    };
    const app = new Hono();
    app.onError(() => new Response("unavailable", {
      status: 500, headers: { "Cache-Control": "public, max-age=60", Vary: "Origin" },
    }));
    app.route("/control", controlRoute({
      auth: AUTH, backend,
      accounts: { async query() {
        if (failure === "accounts") throw new Error("accounts unavailable");
        return { rows: [{ status: "approved" }] };
      } },
    }));
    const token = await signSession({ sub: "alice" }, {
      sessionSecret: AUTH.sessionSecret, ttlSeconds: AUTH.sessionTtlSeconds,
    });
    const res = await app.request("/control/list", {
      headers: { cookie: `radar_session=${token}`, origin: AUTH.appBaseUrl },
    });
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    for (const name of ["Cookie", "Authorization", "Origin"]) {
      expect(res.headers.get("vary")).toContain(name);
    }
  });
});
