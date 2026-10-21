import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { ActivationConfig, AccountStatusQueryable } from "@radar/artifacts-host";
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

const LIVE: ActivationConfig = {
  enabled: true, subjects: ["sub-ok"], expiresAtMs: Date.now() + 3600_000,
};
const EXPIRED: ActivationConfig = { enabled: false, reason: "activation_expired" };

async function cookieFor(sub: string): Promise<string> {
  const token = await signSession(
    { sub },
    { sessionSecret: AUTH.sessionSecret, ttlSeconds: AUTH.sessionTtlSeconds },
  );
  return `radar_session=${token}`;
}

function flippingAccounts(returns: Array<string | null>): { accounts: AccountStatusQueryable; calls: string[] } {
  const calls: string[] = [];
  let index = 0;
  return {
    calls,
    accounts: {
      async query(_text: string, params: unknown[] = []) {
        calls.push(String(params[0]));
        const next = returns[Math.min(index++, returns.length - 1)]!;
        return { rows: next === null ? [] : [{ status: next }] };
      },
    },
  };
}

function makeApp(options: {
  accounts: AccountStatusQueryable;
  readActivation: () => ActivationConfig;
  backendCalls?: string[] | undefined;
}): Hono {
  const backendCalls = options.backendCalls ?? [];
  return new Hono().route("/api/v1/artifacts/control", controlRoute({
    auth: AUTH,
    accounts: options.accounts,
    backend: {
      async handle(op, actorId, _body) {
        backendCalls.push(`${op}:${actorId}`);
        return { status: 201, body: { ok: true } };
      },
    },
    readActivation: options.readActivation,
  }));
}

async function postEnsure(app: Hono, sub: string): Promise<Response> {
  return app.request(ENSURE_URL, { method: "POST",
    headers: { host: APP_HOST, origin: AUTH.appBaseUrl,
      "content-type": "application/json", cookie: await cookieFor(sub) },
    body: "{}" });
}

describe("controlRoute commit-time reread [T05 T13]", () => {
  it("refuses a write when the account is suspended after the entry guard", async () => {
    const backendCalls: string[] = [];
    const flipped = flippingAccounts(["approved", "suspended"]);
    const app = makeApp({ accounts: flipped.accounts, readActivation: () => LIVE, backendCalls });
    const res = await postEnsure(app, "sub-ok");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "account_not_approved", status: "suspended" });
    expect(flipped.calls).toEqual(["sub-ok", "sub-ok"]);
    expect(backendCalls).toEqual([]);
  });

  it("refuses a write when activation expires after the entry guard", async () => {
    const backendCalls: string[] = [];
    let reads = 0;
    const accounts = flippingAccounts(["approved"]).accounts;
    const app = makeApp({
      accounts,
      readActivation: () => (reads++ < 2 ? LIVE : EXPIRED),
      backendCalls,
    });
    const res = await postEnsure(app, "sub-ok");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "activation_closed" });
    expect(backendCalls).toEqual([]);
  });

  it("admits an approved cohort subject to storage", async () => {
    const backendCalls: string[] = [];
    const app = makeApp({
      accounts: flippingAccounts(["approved"]).accounts,
      readActivation: () => LIVE, backendCalls,
    });
    const res = await postEnsure(app, "sub-ok");
    expect(res.status).toBe(201);
    expect(backendCalls).toEqual(["ensure:sub-ok"]);
  });
});
