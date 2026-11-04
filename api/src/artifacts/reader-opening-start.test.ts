import { describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createReaderOpening } from "./reader-opening.js";
import type { AuthConfig } from "../config.js";
import type { AuthorityReader } from "./reader-profile.js";
import type { SharedReaderTickets } from "./reader-tickets.js";

/**
 * Lot I2: no pre-auth existence signal. Every well-formed label — stable or
 * exact, known or unknown — takes the same 303 to the control-origin
 * opening (which resolves the label AFTER authentication). No releaseId is
 * ever revealed before authentication: the old 303 to the version host is
 * gone, and unknown/colliding labels answer exactly like known ones.
 */

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

const start = (app: Hono, host: string) =>
  app.request(`https://${host}/__reader/start`, { headers: { host } });

function approveTarget(res: Response): string {
  const location = res.headers.get("location")!;
  const url = new URL(location);
  expect(url.origin + url.pathname).toBe("https://app.example.test/api/v1/artifacts/reader/approve");
  expect(url.searchParams.get("binding")).toMatch(/^[a-f0-9]{64}$/);
  return `${url.origin}${url.pathname}?origin=${url.searchParams.get("origin")}`;
}

describe("single-level /__reader/start resolution", () => {
  it("redirects a stable (artifact) label straight to the control opening", async () => {
    const { content } = opening({
      releaseForArtifact: { artifactId: ARTIFACT, releaseId: RELEASE, authorSub: "alice" },
      artifactForRelease: null,
    });
    const res = await start(content, `${ARTIFACT}.${BASE}`);
    expect(res.status).toBe(303);
    // No version-host hop: the releaseId is never revealed pre-auth.
    expect(approveTarget(res)).toBe(
      `https://app.example.test/api/v1/artifacts/reader/approve?origin=https://${ARTIFACT}.${BASE}`);
    expect(res.headers.get("location")).not.toContain(RELEASE);
    expect(res.headers.get("set-cookie")).toContain("__Host-preview-init=");
    expect(res.headers.get("set-cookie")).not.toMatch(/Domain=/i);
  });

  it("opens an exact (release) label toward approval with an init cookie", async () => {
    const { content } = opening({ releaseForArtifact: null, artifactForRelease: ARTIFACT });
    const res = await start(content, `${RELEASE}.${BASE}`);
    expect(res.status).toBe(303);
    expect(approveTarget(res)).toBe(
      `https://app.example.test/api/v1/artifacts/reader/approve?origin=https://${RELEASE}.${BASE}`);
    expect(res.headers.get("set-cookie")).toContain("__Host-preview-init=");
    expect(res.headers.get("set-cookie")).not.toMatch(/Domain=/i);
  });

  it("answers unknown and colliding labels exactly like known ones", async () => {
    const known = await start(
      opening({
        releaseForArtifact: { artifactId: ARTIFACT, releaseId: RELEASE, authorSub: "alice" },
        artifactForRelease: null,
      }).content, `${ARTIFACT}.${BASE}`);
    const unknown = await start(
      opening({ releaseForArtifact: null, artifactForRelease: null }).content, `${UNKNOWN}.${BASE}`);
    const collided = await start(
      opening({
        releaseForArtifact: { artifactId: ARTIFACT, releaseId: RELEASE, authorSub: "alice" },
        artifactForRelease: "other-artifact",
      }).content, `${ARTIFACT}.${BASE}`);
    for (const res of [unknown, collided]) {
      expect(res.status).toBe(known.status);
      expect(approveTarget(res)).toContain("/api/v1/artifacts/reader/approve");
      expect(res.headers.get("set-cookie")).toContain("__Host-preview-init=");
    }
    expect(approveTarget(unknown)).toContain(`origin=https://${UNKNOWN}.${BASE}`);
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
