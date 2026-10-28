// Shared createApp + PostgreSQL harness for the PW-C application surface.
import { randomBytes } from "node:crypto";
import { createApp } from "../app.js";
import type { AuthConfig } from "../config.js";
import { signSession } from "../services/auth/session.js";
import type { workspaceFixture } from "../services/facets/workspace-archive-fixture.js";
import { createWriteAppSurface } from "./write-intent-app-surface.js";
import type { PwIdentityDomain } from "./write-intent-principal.js";

export const ISSUER = "https://auth.example.test";
export const APP_ORIGIN = "https://app.example.test";
const SECRET = "test-session-secret-32-bytes-long!!";

export const AUTH = { enabled: true, issuer: ISSUER, clientId: "test-client",
  clientSecret: "test-secret", redirectUri: `${APP_ORIGIN}/cb`, scopes: "openid",
  appBaseUrl: APP_ORIGIN, sessionSecret: SECRET, sessionTtlSeconds: 3600,
  sessionAbsoluteTtlSeconds: 7200, jwksUri: `${ISSUER}/.well-known/jwks.json`,
  bearerAudiences: [APP_ORIGIN] } as AuthConfig;

type Fixture = Awaited<ReturnType<typeof workspaceFixture>>;

export async function surface(f: Fixture,
  domain: Pick<PwIdentityDomain, "identityIssuer" | "tier"> = { identityIssuer: ISSUER, tier: "preprod" }) {
  const app = createApp({ checkDb: async () => ({ ok: true }), checkObjectStore: async () => ({ ok: true }),
    db: f.db,
    store: {
      get: async () => { throw new Error("unexpected object read"); },
      head: async () => { throw new Error("unexpected object probe"); },
      put: async () => { throw new Error("unexpected object write"); },
    },
    writeApp: createWriteAppSurface({ auth: { ...AUTH, issuer: domain.identityIssuer },
    domain: { ...domain, appOrigin: APP_ORIGIN, clientId: "test-client" },
    accounts: { query: async (text: string, params: unknown[] = []) => {
      const res = await f.pool.query(text, params);
      return { rows: res.rows as Array<{ status: string }> };
    } },
    sessionSecret: SECRET,
    db: f.db,
    challengeKeys: new Map([["synthetic-key-1", randomBytes(32)]]) }) });
  const cookie = async (sub: string, name?: string): Promise<string> => {
    const token = await signSession(name === undefined ? { sub } : { sub, name },
      { sessionSecret: SECRET, ttlSeconds: 3600 });
    return `radar_session=${token}`;
  };
  const host = "app.example.test";
  return { app, host, cookie };
}

export function bootstrapOf(html: string): Record<string, unknown> {
  const match = html.match(
    /<script id="pw-bootstrap" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error("missing private bootstrap");
  return JSON.parse(match[1]!) as Record<string, unknown>;
}

export function post(app: ReturnType<typeof createApp>, host: string, url: string,
  cookie: string, csrf: string, body: unknown, origin = APP_ORIGIN) {
  return app.request(url, { method: "POST",
    headers: { host, cookie, origin, "content-type": "application/json",
      "x-artifact-write-csrf": csrf }, body: JSON.stringify(body) });
}
