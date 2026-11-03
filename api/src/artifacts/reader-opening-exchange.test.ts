import { describe, expect, it } from "vitest";
import { createReaderOpening, expiredReaderOpeningHtml } from "./reader-opening.js";
import type { AuthConfig } from "../config.js";
import { createFixtureAuthority, fingerprintReaderProfile } from "./reader-profile.js";
import type { PreviewTicket } from "./preview-tickets.js";
import type { SharedReaderTickets } from "./reader-tickets.js";

const BASE = "pages.example.test";
const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE = "123e4567-e89b-12d3-a456-426614174001";
const HOST = `${RELEASE}.${BASE}`;
const ORIGIN = `https://${HOST}`;
const BINDING = "a".repeat(64);
const TICKET = "b".repeat(64);

const AUTH: AuthConfig = {
  enabled: true, issuer: "https://auth.example.test", clientId: "radar-immobilier",
  clientSecret: "super-secret",
  redirectUri: "https://app.example.test/api/v1/auth/oauth/callback",
  scopes: "openid profile email", appBaseUrl: "https://app.example.test",
  sessionSecret: "session-secret-32-bytes-long-padding!!",
  sessionTtlSeconds: 3600, sessionAbsoluteTtlSeconds: 7200,
  jwksUri: "https://auth.example.test/.well-known/jwks.json",
  bearerAudiences: ["https://app.example.test", "https://app.example.test/mcp"],
};

const ISSUER = { issuer: "https://app.example.test", audience: "https://app.example.test/reader", tier: "preprod" };

function record(origin = ORIGIN): PreviewTicket {
  return {
    browserBinding: BINDING, ticket: TICKET, origin, artifactId: ARTIFACT, releaseId: RELEASE,
    profileName: "demo", policyRevision: "pol-001",
    profileFingerprint: fingerprintReaderProfile({ name: "demo", policyRevision: "pol-001",
      capabilities: ["geo.read", "signals.protected-read"] }),
    readerSub: "reader-alice", returnTarget: "/", expiresAt: Date.now() + 600_000,
  };
}

function opening(consume: SharedReaderTickets["consume"]) {
  const tickets = { mint: async () => { throw new Error("unused"); }, consume } as unknown as SharedReaderTickets;
  return createReaderOpening({ auth: AUTH, contentBase: BASE, authority: createFixtureAuthority(),
    tickets, issuer: ISSUER, grantSecret: "grant-secret-32-bytes-long-padding!",
    sessionSecret: "session-secret-32-bytes-long-pad!!" });
}

const exchange = (app: { request: Function }, query: string, headers: Record<string, string>) =>
  (app as unknown as { request: (url: string, init?: RequestInit) => Promise<Response> })
    .request(`https://${HOST}/__reader/exchange${query}`, { headers: { host: HOST, ...headers } });

const BROWSER = { accept: "text/html,application/xhtml+xml" };
const BINDING_COOKIE = `__Host-preview-init=${BINDING}`;
const RETRY_COOKIE = "__Host-preview-retry=1";

describe("reader exchange browser recovery", () => {
  it("sets a 10-minute binding cookie so late approvals keep their binding", async () => {
    const authority = {
      getAuthorizationVersion: async () => "v1",
      getContentOrigin: async () => ORIGIN,
      getRelease: async () => null,
      getProfile: async () => null,
      getRights: async () => null,
    };
    const tickets = { mint: async () => { throw new Error("unused"); }, consume: async () => null } as unknown as SharedReaderTickets;
    const { content } = createReaderOpening({ auth: AUTH, contentBase: BASE, authority, tickets,
      issuer: ISSUER, grantSecret: "grant-secret-32-bytes-long-padding!",
      sessionSecret: "session-secret-32-bytes-long-pad!!",
      getArtifactIdForRelease: async () => ARTIFACT });
    const res = await content.request(`https://${HOST}/__reader/start`, { headers: { host: HOST } });
    expect(res.status).toBe(303);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=600");
  });

  it("keeps the 401 JSON for non-browser exchange failures", async () => {
    const { content } = opening(async () => null);
    const res = await exchange(content, `?ticket=${TICKET}`, { cookie: BINDING_COOKIE });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("redirects the first browser failure to /__reader/start with a retry marker", async () => {
    const { content } = opening(async () => null);
    const res = await exchange(content, `?ticket=${TICKET}`, { cookie: BINDING_COOKIE, ...BROWSER });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/__reader/start");
    expect(res.headers.get("set-cookie")).toContain("__Host-preview-retry=1");
  });

  it("restarts reused tickets once, then shows the neutral page without looping", async () => {
    let live: PreviewTicket | null = record();
    const { content } = opening(async () => {
      const hit = live; live = null; return hit;
    });
    const first = await exchange(content, `?ticket=${TICKET}`, { cookie: BINDING_COOKIE, ...BROWSER });
    expect(first.status).toBe(303);
    expect(first.headers.get("location")).toContain("grant=");
    const retryCleared = first.headers.getSetCookie().join(";");
    expect(retryCleared).toContain("__Host-preview-retry=;");
    const restart = await exchange(content, `?ticket=${TICKET}`, { cookie: BINDING_COOKIE, ...BROWSER });
    expect(restart.status).toBe(303);
    expect(restart.headers.get("location")).toBe("/__reader/start");
    const retry = restart.headers.getSetCookie().find((h) => h.startsWith("__Host-preview-retry="))!.split(";")[0]!;
    const expired = await exchange(content, `?ticket=${TICKET}`, { cookie: `${BINDING_COOKIE}; ${retry}`, ...BROWSER });
    expect(expired.status).toBe(401);
    expect(expired.headers.get("content-type")).toContain("text/html");
    expect(expired.headers.get("location")).toBeNull();
  });

  it("renders the same neutral page for every cause without leaking state", async () => {
    const unknown = await exchange(opening(async () => null).content, `?ticket=${TICKET}`,
      { cookie: `${BINDING_COOKIE}; ${RETRY_COOKIE}`, ...BROWSER });
    const mismatch = await exchange(opening(async () => record("https://other.pages.example.test")).content,
      `?ticket=${TICKET}`, { cookie: `${BINDING_COOKIE}; ${RETRY_COOKIE}`, ...BROWSER });
    expect(unknown.status).toBe(401);
    expect(await unknown.text()).toBe(await mismatch.text());
    const body = await exchange(opening(async () => null).content, "?ticket=not-a-ticket",
      { cookie: RETRY_COOKIE, ...BROWSER }).then((r) => r.text());
    expect(body).toBe(expiredReaderOpeningHtml());
    expect(body).toContain("Ce lien d'ouverture a expiré");
    expect(body).toContain("Rouvrir la page");
    expect(body).toContain('href="/__reader/start"');
    for (const secret of [ARTIFACT, RELEASE, TICKET, BINDING, "unauthenticated", "ticket"]) {
      expect(body.includes(secret), secret).toBe(false);
    }
  });
});
