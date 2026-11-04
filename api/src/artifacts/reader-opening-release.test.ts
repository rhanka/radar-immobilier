import { describe, expect, it } from "vitest";
import { createReaderOpening } from "./reader-opening.js";
import type { AuthorityReader } from "./reader-profile.js";
import { createTicketStore } from "./preview-tickets.js";
import { signSession, SESSION_COOKIE_NAME } from "../services/auth/session.js";
import type { AuthConfig } from "../config.js";

/**
 * Lot I2 review remark: the approval spread `{ ...params, ...resolved }`
 * let a client-supplied `requestedRelease` survive when the origin label
 * resolved to a stable artifact. The artifact/release pair must come from
 * the server-side origin resolution only.
 */
const BASE = "pages.example.test";
const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE_A = "123e4567-e89b-12d3-a456-426614174001";
const RELEASE_B = "123e4567-e89b-12d3-a456-426614174002";

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

const PROFILE = { name: "demo", policyRevision: "pol-001", capabilities: ["signals.protected-read"] as const };

// Two retained releases for one artifact: the stub honors an explicit
// requestedRelease, so the test can tell server resolution apart from a
// client-supplied value.
const authority: AuthorityReader = {
  getAuthorizationVersion: async () => "v1",
  getContentOrigin: async (id) => id === ARTIFACT ? `https://${ARTIFACT}.${BASE}` : null,
  getRelease: async (id, requested) => {
    if (id === ARTIFACT && requested === undefined) {
      return { artifactId: ARTIFACT, releaseId: RELEASE_A, authorSub: "author-alice" };
    }
    if (id === ARTIFACT && (requested === RELEASE_A || requested === RELEASE_B)) {
      return { artifactId: ARTIFACT, releaseId: requested, authorSub: "author-alice" };
    }
    if ((id === RELEASE_A || id === RELEASE_B) && requested === undefined) {
      return { artifactId: ARTIFACT, releaseId: id, authorSub: "author-alice" };
    }
    return null;
  },
  getProfile: async (id) => id === ARTIFACT ? { ...PROFILE, capabilities: [...PROFILE.capabilities] } : null,
  getRights: async (readerSub, id) => id === ARTIFACT && readerSub === "reader-alice"
    ? { readerSub, artifactId: ARTIFACT, approved: true, capabilities: ["signals.protected-read"] } : null,
};

function hiddenFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const m of html.matchAll(/name="([^"]+)" value="([^"]*)"/g)) fields[m[1]!] = m[2]!;
  return fields;
}

describe("opening release resolution", () => {
  it("should ignore a client-supplied requestedRelease on the stable label", async () => {
    const opening = createReaderOpening({ auth: AUTH, contentBase: BASE, authority,
      tickets: createTicketStore() as never, issuer: { issuer: "https://app.example.test",
        audience: "https://app.example.test/reader", tier: "preprod" },
      grantSecret: "grant-secret-32-bytes-long-padding!", sessionSecret: "session-secret-32-bytes-long-pad!!",
      getArtifactIdForRelease: async () => null });
    const token = await signSession({ sub: "reader-alice", emailVerified: true, idpIssuer: "https://auth.example.test" },
      { sessionSecret: AUTH.sessionSecret, ttlSeconds: 3600 });
    const session = `${SESSION_COOKIE_NAME}=${token}`;
    const res = await opening.application.request(
      `/approve?binding=${"b".repeat(64)}&origin=${encodeURIComponent(`https://${ARTIFACT}.${BASE}`)}` +
      `&requestedRelease=${RELEASE_B}`,
      { headers: { cookie: session, accept: "text/html,application/xhtml+xml" } });
    expect(res.status).toBe(200);
    // The served opening pins the server-resolved current release, not the injected one.
    expect(hiddenFields(await res.text()).releaseId).toBe(RELEASE_A);
  });
});
