// PW-A PWA-08c: application CSRF bound to origin, principal, cookie, intent.
import { describe, expect, it } from "vitest";
import { canonicalAppPrincipal, resolvePwIdentityDomain } from "./write-intent-principal.js";
import { issueWriteIntentCsrf, verifyWriteIntentCsrf } from "./write-intent-csrf.js";
import type { AuthConfig } from "../config.js";

const AUTH: AuthConfig = {
  enabled: true, issuer: "https://auth.sent-tech.ca", clientId: "client-1",
  clientSecret: "secret", redirectUri: "https://immo.sent-tech.ca/callback",
  scopes: "openid", appBaseUrl: "https://immo.sent-tech.ca",
  sessionSecret: "session-secret-32-bytes-long-pad!!",
  sessionTtlSeconds: 100, sessionAbsoluteTtlSeconds: 200,
  jwksUri: "", bearerAudiences: [],
};

describe("write csrf", () => {
  it("should bind csrf to origin, principal, cookie, and intent", () => {
    const domain = resolvePwIdentityDomain({ ...AUTH }, "prod")!;
    const principal = canonicalAppPrincipal({ sub: "s-1", exp: 2_000, iat: 1_000 }, domain);
    const args = { domain, principal, rawCookie: "cookie-1",
      intentId: "11111111-1111-4111-8111-111111111111",
      issuedAtMs: 1_000_000, sessionExpSec: 2_000,
      sessionSecret: "session-secret-32-bytes-long-pad!!" };
    const token = issueWriteIntentCsrf(args);
    expect(token.length).toBeLessThanOrEqual(512);
    expect(verifyWriteIntentCsrf({ ...args, token, nowMs: 1_000_500 })).toBe(true);
    expect(verifyWriteIntentCsrf({ ...args, token, nowMs: 1_000_500, rawCookie: "cookie-2" })).toBe(false);
    expect(verifyWriteIntentCsrf({ ...args, token, nowMs: 3_000_000 })).toBe(false);
  });
});
