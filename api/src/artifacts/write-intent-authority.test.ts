// PW-A PWA-08a: identity domain and full principal equality.
import { describe, expect, it } from "vitest";
import {
  canonicalAppPrincipal,
  resolvePwIdentityDomain,
  samePwPrincipal,
  canonicalWritePrincipal,
} from "./write-intent-principal.js";
import { signSession, verifySession } from "../services/auth/session.js";
import { mintWriteGrant, verifyWriteGrant } from "./write-grant.js";
import { loadConfig } from "../config.js";
import type { AuthConfig } from "../config.js";

const AUTH: AuthConfig = {
  enabled: true, issuer: "https://auth.sent-tech.ca", clientId: "client-1",
  clientSecret: "secret", redirectUri: "https://immo.sent-tech.ca/callback",
  scopes: "openid", appBaseUrl: "https://immo.sent-tech.ca",
  sessionSecret: "session-secret-32-bytes-long-pad!!",
  sessionTtlSeconds: 100, sessionAbsoluteTtlSeconds: 200,
  jwksUri: "", bearerAudiences: [],
};

describe("write identity domain", () => {
  it("should resolve the prod domain and compare full principals", () => {
    const domain = resolvePwIdentityDomain({ ...AUTH }, "prod");
    expect(domain?.appOrigin).toBe("https://immo.sent-tech.ca");
    expect(resolvePwIdentityDomain({ ...AUTH }, "dev")).toBeNull();
    expect(resolvePwIdentityDomain({ ...AUTH, enabled: false }, "prod")).toBeNull();
    const left = canonicalAppPrincipal({ sub: "s-1", exp: 2, iat: 1 }, domain!);
    expect(samePwPrincipal(left, { ...left })).toBe(true);
    expect(samePwPrincipal(left, { ...left, tier: "preprod" })).toBe(false);
  });

  it("should close PW on absent tier or inconsistent canonical domains", () => {
    expect(loadConfig({}).PW_IDENTITY_TIER).toBeUndefined();
    expect(loadConfig({ PW_IDENTITY_TIER: "" }).PW_IDENTITY_TIER).toBeUndefined();
    expect(() => loadConfig({ PW_IDENTITY_TIER: "dev" })).toThrow();
    expect(loadConfig({ PW_IDENTITY_TIER: "preprod" }).PW_IDENTITY_TIER).toBe("preprod");
    for (const appBaseUrl of ["http://immo.sent-tech.ca", "https://immo.sent-tech.ca/path",
      "https://immo.sent-tech.ca?x=1", "https://user@immo.sent-tech.ca", "https://preprod.immo.sent-tech.ca"]) {
      expect(resolvePwIdentityDomain({ ...AUTH, appBaseUrl }, "prod")).toBeNull();
    }
    expect(resolvePwIdentityDomain({ ...AUTH }, undefined)).toBeNull();
    expect(resolvePwIdentityDomain({ ...AUTH, issuer: "https://another-idp.test" }, "prod")).toBeNull();
  });

  it("should compare full principals from verified cookies and grants with separate H5 and identity issuers", async () => {
    const domain = resolvePwIdentityDomain({ ...AUTH }, "prod")!;
    const token = await signSession({ sub: "same-sub" }, { sessionSecret: AUTH.sessionSecret, ttlSeconds: 100, now: 1000 });
    const session = await verifySession(token, { sessionSecret: AUTH.sessionSecret, now: 2000 });
    const appPrincipal = canonicalAppPrincipal(session!, domain);
    const grant = { issuer: "https://h5.example.test", audience: "radar-artifact-write", tier: "prod",
      sub: "same-sub", readerSub: "same-sub", identityIssuer: domain.identityIssuer,
      jti: "grant-1", sessionId: "page-1", artifactId: "artifact-1", releaseId: "release-1",
      host: "content.pages.test", profileName: "h5-signal-write-v2", profileFingerprint: "a".repeat(64),
      policyRevision: "policy-1", workspaceId: "11111111-1111-4111-8111-111111111111",
      citySlug: "test-city", operations: ["facets.signals.personal.select.v1"] };
    for (const patch of [{}, { identityIssuer: "https://another-idp.test" }, { tier: "preprod" }]) {
      const claims = { ...grant, ...patch };
      const jwt = await mintWriteGrant(claims, "synthetic-write-key-distinct-from-session", 1000);
      const verified = await verifyWriteGrant(jwt, claims, "synthetic-write-key-distinct-from-session", 2000);
      expect(verified).not.toBeNull();
      expect(samePwPrincipal(appPrincipal, canonicalWritePrincipal(verified!))).toBe(Object.keys(patch).length === 0);
    }
  });
});
