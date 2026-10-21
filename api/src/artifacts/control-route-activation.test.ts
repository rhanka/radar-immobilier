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
const OFF: ActivationConfig = { enabled: false, reason: "activation_off" };

async function cookieFor(sub: string): Promise<string> {
  const token = await signSession(
    { sub },
    { sessionSecret: AUTH.sessionSecret, ttlSeconds: AUTH.sessionTtlSeconds },
  );
  return `radar_session=${token}`;
}

function stubAccounts(statuses: Record<string, string>, calls: string[] = []): AccountStatusQueryable {
  return {
    async query(_text: string, params: unknown[] = []) {
      const sub = typeof params[0] === "string" ? params[0] : "?";
      calls.push(sub);
      const status = statuses[sub];
      return { rows: status === undefined ? [] : [{ status }] };
    },
  };
}

function makeApp(options: {
  accounts: AccountStatusQueryable;
  readActivation?: (() => ActivationConfig) | undefined;
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
    ...(options.readActivation ? { readActivation: options.readActivation } : {}),
  }));
}

async function postEnsure(app: Hono, sub: string | undefined): Promise<Response> {
  const headers: Record<string, string> = {
    host: APP_HOST, origin: AUTH.appBaseUrl, "content-type": "application/json",
  };
  if (sub !== undefined) headers["cookie"] = await cookieFor(sub);
  return app.request(ENSURE_URL, { method: "POST", headers, body: "{}" });
}

describe("controlRoute cohort admission [T02 T05 T17 T24]", () => {
  it("refuses an approved non-cohort subject without calling storage", async () => {
    const backendCalls: string[] = [];
    const app = makeApp({
      accounts: stubAccounts({ "sub-ok": "approved", other: "approved" }),
      readActivation: () => LIVE, backendCalls,
    });
    const res = await postEnsure(app, "other");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "not_in_cohort" });
    expect(backendCalls).toEqual([]);
  });

  it("refuses suspended and unknown accounts without calling storage", async () => {
    for (const [sub, expected] of [
      ["sub-suspended", "suspended"], ["ghost", "unknown"],
    ] as const) {
      const backendCalls: string[] = [];
      const app = makeApp({
        accounts: stubAccounts({ "sub-ok": "approved", "sub-suspended": "suspended" }),
        readActivation: () => ({ ...LIVE, subjects: [sub] }), backendCalls,
      });
      const res = await postEnsure(app, sub);
      expect(res.status, sub).toBe(403);
      expect(await res.json(), sub).toEqual({ error: "account_not_approved", status: expected });
      expect(backendCalls, sub).toEqual([]);
    }
  });

  it("refuses expired and off activation without querying accounts or storage", async () => {
    for (const activation of [EXPIRED, OFF]) {
      const accountCalls: string[] = [];
      const backendCalls: string[] = [];
      const app = makeApp({
        accounts: stubAccounts({ "sub-ok": "approved" }, accountCalls),
        readActivation: () => activation, backendCalls,
      });
      const res = await postEnsure(app, "sub-ok");
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "activation_closed" });
      expect(accountCalls).toEqual([]);
      expect(backendCalls).toEqual([]);
    }
  });
});
