import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AccountStatusQueryable } from "@radar/artifacts-host";
import { controlRoute } from "./control-route.js";
import type { AuthConfig } from "../config.js";
import { signSession } from "../services/auth/session.js";

const AUTH: AuthConfig = {
  enabled: true, issuer: "https://auth.example.test", clientId: "radar-immobilier",
  clientSecret: "super-secret", redirectUri: "https://app.example.test/api/v1/auth/oauth/callback",
  scopes: "openid profile email", appBaseUrl: "https://app.example.test",
  sessionSecret: "session-secret-32-bytes-long-padding!!", sessionTtlSeconds: 3600,
  sessionAbsoluteTtlSeconds: 7200, jwksUri: "https://auth.example.test/.well-known/jwks.json",
  bearerAudiences: ["https://app.example.test", "https://app.example.test/mcp"],
};

const APP_HOST = "app.example.test";
const ENSURE_URL = `http://${APP_HOST}/api/v1/artifacts/control/ensure`;
const LIVE = { enabled: true as const, subjects: ["sub-ok"], expiresAtMs: Date.now() + 3600_000 };

async function cookieFor(sub: string): Promise<string> {
  const token = await signSession({ sub },
    { sessionSecret: AUTH.sessionSecret, ttlSeconds: AUTH.sessionTtlSeconds });
  return `radar_session=${token}`;
}

function failingAccounts(error: Error): AccountStatusQueryable {
  return { async query() { throw error; } };
}

function appWith(accounts: AccountStatusQueryable): Hono {
  return new Hono().route("/api/v1/artifacts/control", controlRoute({
    auth: AUTH, accounts,
    backend: { handle: async () => ({ status: 201, body: { ok: true } }) },
    readActivation: () => LIVE, storageScope: "scope",
  }));
}

async function postEnsure(app: Hono): Promise<Response> {
  return app.request(ENSURE_URL, { method: "POST",
    headers: { host: APP_HOST, origin: AUTH.appBaseUrl,
      "content-type": "application/json", cookie: await cookieFor("sub-ok") },
    body: "{}" });
}

describe("controlRoute admission outage mapping", () => {
  it("maps pool saturation at entry to 503", async () => {
    const res = await postEnsure(appWith(failingAccounts(new Error("timeout exceeded when trying to connect"))));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "capability_unavailable" });
  });

  it("maps connection-open timeout at entry to 503", async () => {
    const res = await postEnsure(appWith(
      failingAccounts(new Error("Connection terminated due to connection timeout"))));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "capability_unavailable" });
  });

  it("maps a throwing backend to 503", async () => {
    const accounts: AccountStatusQueryable = {
      async query(text: string) {
        if (text.includes("workspace_memberships")) return { rows: [{ status: "x", workspace_id: "scope" }] };
        return { rows: [{ status: "approved" }] };
      },
    };
    const app = new Hono().route("/api/v1/artifacts/control", controlRoute({
      auth: AUTH, accounts,
      backend: { handle: async () => { throw new Error("timeout exceeded when trying to connect"); } },
      readActivation: () => LIVE, storageScope: "scope",
    }));
    const res = await postEnsure(app);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "capability_unavailable" });
  });
});
