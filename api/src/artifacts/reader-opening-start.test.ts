import { describe, expect, it } from "vitest";
import { createReaderOpening } from "./reader-opening.js";
import type { AuthConfig } from "../config.js";
import type { AuthorityReader } from "./reader-profile.js";
import type { SharedReaderTickets } from "./reader-tickets.js";

const BASE = "pages.example.test";
const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE = "123e4567-e89b-12d3-a456-426614174001";
const UNKNOWN = "123e4567-e89b-12d3-a456-426614174099";

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

const tickets = {
  mint: async () => { throw new Error("unused"); },
  consume: async () => null,
} as unknown as SharedReaderTickets;

function opening(options: {
  releaseForArtifact?: { artifactId: string; releaseId: string; authorSub: string } | null;
  artifactForRelease?: string | null;
}) {
  const authority: AuthorityReader = {
    getAuthorizationVersion: async () => "v1",
    getContentOrigin: async (id) => `https://${id}.${BASE}`,
    getRelease: async (id) => options.releaseForArtifact && id === options.releaseForArtifact.artifactId
      ? options.releaseForArtifact : null,
    getProfile: async () => null,
    getRights: async () => null,
  };
  return createReaderOpening({ auth: AUTH, contentBase: BASE, authority, tickets,
    issuer: ISSUER, grantSecret: "grant-secret-32-bytes-long-padding!",
    sessionSecret: "session-secret-32-bytes-long-pad!!",
    getArtifactIdForRelease: async () => options.artifactForRelease ?? null });
}

const start = (app: { request: (url: string, init?: RequestInit) => Promise<Response> }, host: string) =>
  app.request(`https://${host}/__reader/start`, { headers: { host } });

describe("single-level /__reader/start resolution", () => {
  it("redirects a stable (artifact) label to its current release host", async () => {
    const { content } = opening({
      releaseForArtifact: { artifactId: ARTIFACT, releaseId: RELEASE, authorSub: "alice" },
      artifactForRelease: null,
    });
    const res = await start(content, `${ARTIFACT}.${BASE}`);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`https://${RELEASE}.${BASE}/__reader/start`);
  });

  it("opens an exact (release) label toward approval with an init cookie", async () => {
    const { content } = opening({ releaseForArtifact: null, artifactForRelease: ARTIFACT });
    const res = await start(content, `${RELEASE}.${BASE}`);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/api/v1/artifacts/reader/approve");
    expect(res.headers.get("set-cookie")).toContain("__Host-preview-init=");
    expect(res.headers.get("set-cookie")).not.toMatch(/Domain=/i);
  });

  it("answers the same 404 for unknown and colliding labels without leaking the kind", async () => {
    const unknown = await start(
      opening({ releaseForArtifact: null, artifactForRelease: null }).content, `${UNKNOWN}.${BASE}`);
    expect(unknown.status).toBe(404);
    const collided = await start(
      opening({
        releaseForArtifact: { artifactId: ARTIFACT, releaseId: RELEASE, authorSub: "alice" },
        artifactForRelease: "other-artifact",
      }).content, `${ARTIFACT}.${BASE}`);
    expect(collided.status).toBe(404);
    expect(await collided.json()).toEqual(await unknown.json());
  });

  it("refuses retired, malformed and foreign labels as unknown", async () => {
    const { content } = opening({ releaseForArtifact: null, artifactForRelease: null });
    for (const host of [`${RELEASE}.pinned.${BASE}`, `not-a-uuid.${BASE}`,
      "preprod.immo.sent-tech.ca", BASE]) {
      const res = await start(content, host);
      expect(res.status, host).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
  });
});
