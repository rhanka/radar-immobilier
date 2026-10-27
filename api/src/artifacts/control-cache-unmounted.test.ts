import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { AuthConfig } from "../config.js";
import type { Database } from "../db/client.js";
import type { ObjectStore } from "../storage/object-store.js";
import { signSession } from "../services/auth/session.js";

const auth: AuthConfig = {
  enabled: true, issuer: "https://auth.example.test", clientId: "radar", clientSecret: "test-client",
  redirectUri: "https://app.example.test/api/v1/auth/oauth/callback", scopes: "openid",
  appBaseUrl: "https://app.example.test", sessionSecret: "test-session-secret-32-bytes-padding",
  sessionTtlSeconds: 3600, sessionAbsoluteTtlSeconds: 7200,
  jwksUri: "https://auth.example.test/jwks", bearerAudiences: ["https://app.example.test"],
};

async function cookie(sub: string): Promise<string> {
  return `radar_session=${await signSession({ sub }, { sessionSecret: auth.sessionSecret, ttlSeconds: 3600 })}`;
}

// No artifactsControl: the H3 capability is absent (storage unset), but auth
// is enabled, so the control prefix must still answer with the private
// cache policy instead of falling through to the generic chain.
const app = createApp({ auth, store: {} as ObjectStore, db: {} as Database,
  checkDb: async () => ({ ok: true }), checkObjectStore: async () => ({ ok: true }) });

const ENSURE = "https://app.example.test/api/v1/artifacts/control/ensure";
const LIST = "https://app.example.test/api/v1/artifacts/control/list";

function expectPrivate(res: Response): void {
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(res.headers.get("vary")).toContain("Cookie");
  expect(res.headers.get("vary")).toContain("Authorization");
}

describe("control cache headers when the capability is unmounted [T29]", () => {
  it("marks the anonymous refusal private", async () => {
    const res = await app.request(ENSURE, { method: "POST",
      headers: { origin: auth.appBaseUrl, "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expectPrivate(res);
  });

  it("marks authenticated unavailable responses private", async () => {
    const session = await cookie("alice");
    const post = await app.request(ENSURE, { method: "POST",
      headers: { origin: auth.appBaseUrl, "content-type": "application/json", cookie: session }, body: "{}" });
    expect(post.status).toBe(503);
    expect(await post.json()).toEqual({ error: "capability_unavailable" });
    expectPrivate(post);
    const get = await app.request(LIST, { headers: { origin: auth.appBaseUrl, cookie: session } });
    expect(get.status).toBe(503);
    expectPrivate(get);
  });

  it("marks origin and Bearer [REDACTED] refusals private", async () => {
    const session = await cookie("alice");
    const foreign = await app.request(ENSURE, { method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json", cookie: session }, body: "{}" });
    expect(foreign.status).toBe(403);
    expectPrivate(foreign);
    const bearer = await app.request(ENSURE, { method: "POST",
      headers: { origin: auth.appBaseUrl, "content-type": "application/json",
        cookie: session, authorization: "Bearer [REDACTED]" }, body: "{}" });
    expect(bearer.status).toBe(401);
    expectPrivate(bearer);
  });
});
