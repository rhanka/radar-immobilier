import { createApp } from "../../src/app.js";
import type { AuthConfig } from "../../src/config.js";
import { signSession } from "../../src/services/auth/session.js";
import { EMPTY_DISCARDED_SIGNALS } from "../../src/services/graph/discarded-signals.js";
import type { ObjectStore } from "../../src/storage/object-store.js";
import { fixture, type Fixture } from "../../src/services/facets/scope-db-fixture.js";

export const baseAuth: AuthConfig = {
  enabled: true,
  issuer: "https://auth.example.test",
  clientId: "test-client",
  clientSecret: "test-only",
  redirectUri: "https://app.example.test/callback",
  scopes: "openid",
  appBaseUrl: "https://app.example.test",
  sessionSecret: "test-only-base-api-fixture-key-32-chars",
  sessionTtlSeconds: 3600,
  sessionAbsoluteTtlSeconds: 7200,
  jwksUri: "https://auth.example.test/jwks",
  bearerAudiences: ["https://app.example.test"],
};

export async function baseCookie(sub: string): Promise<string> {
  const token = await signSession(
    { sub },
    { sessionSecret: baseAuth.sessionSecret, ttlSeconds: 3600 },
  );
  return `radar_session=${token}`;
}

export interface ComposedBase {
  data: Fixture;
  app: ReturnType<typeof createApp>;
  cookie: (sub: string) => Promise<string>;
}

export async function startComposedBase(): Promise<ComposedBase> {
  const data = await fixture();
  const app = createApp({
    checkDb: async () => ({ ok: true }),
    checkObjectStore: async () => ({ ok: true }),
    store: {} as ObjectStore,
    db: data.db,
    discarded: EMPTY_DISCARDED_SIGNALS,
    auth: baseAuth,
  });
  return { data, app, cookie: baseCookie };
}
