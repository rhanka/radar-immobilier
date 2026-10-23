import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { createTicketStore } from "./preview-tickets.js";
import { mintGrant, verifyGrant, type GrantClaims } from "./preview-grant.js";
import { renewGrant } from "./preview-renewal.js";
import { createFixtureAuthority } from "./reader-profile.js";

const SECRET = "test-grant-secret-32-bytes-padding";
const GRANT: GrantClaims = {
  issuer: "https://api.example.test", audience: "reader", tier: "test",
  host: "123e4567-e89b-12d3-a456-426614174000.pages.example.test",
  artifactId: "123e4567-e89b-12d3-a456-426614174000",
  releaseId: "123e4567-e89b-12d3-a456-426614174001", readerSub: "reader-alice",
  sessionId: "session-1", profileName: "demo", policyRevision: "pol-001",
};

describe("preview security boundaries", () => {
  it("should refuse a ticket stolen from another browser", () => {
    const store = createTicketStore({ now: () => 1_000 });
    const input = { origin: `https://${GRANT.host}`, artifactId: GRANT.artifactId,
      releaseId: GRANT.releaseId, profileName: "demo", readerSub: "reader-alice",
      returnTarget: "/", browserBinding: "browser-secret-at-least-32-characters" };
    const ticket = store.mint(input);
    expect(store.consume(ticket.ticket, "another-browser-secret")).toBeNull();
    expect(store.consume(ticket.ticket, input.browserBinding)).not.toBeNull();
    expect(store.consume(ticket.ticket, input.browserBinding)).toBeNull();
  });

  it("should refuse grants without expiry or with an excessive lifetime", async () => {
    const key = new TextEncoder().encode(SECRET);
    for (const expiry of [undefined, 3_600]) {
      let jwt = new SignJWT({ ...GRANT }).setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setIssuer(GRANT.issuer).setAudience(GRANT.audience).setSubject(GRANT.readerSub).setIssuedAt(1);
      if (expiry !== undefined) jwt = jwt.setExpirationTime(expiry);
      expect(await verifyGrant(await jwt.sign(key), GRANT, SECRET, 2_000)).toBeNull();
    }
  });

  it("should refuse renewal after the current release changes", async () => {
    const authority = { ...createFixtureAuthority(), getRelease: async () => ({
      artifactId: GRANT.artifactId, releaseId: "new-release", authorSub: "publisher" }) };
    expect(await renewGrant(await mintGrant(GRANT, SECRET, 1_000),
      { authority, secret: SECRET, issuer: GRANT }, () => false, 2_000)).toBeNull();
  });

  it("should fail renewal closed during a control outage", async () => {
    const authority = { ...createFixtureAuthority(), getRights: async () => { throw new Error("outage"); } };
    expect(await renewGrant(await mintGrant(GRANT, SECRET, 1_000),
      { authority, secret: SECRET, issuer: GRANT }, () => false, 2_000)).toBeNull();
  });
  it("should recheck current approval and policy on renewal", async () => {
    const base = createFixtureAuthority();
    const changes = [
      { ...base, getRights: async () => ({ readerSub: GRANT.readerSub, approved: false,
        capabilities: ["geo.read" as const] }) },
      { ...base, getProfile: async () => ({ name: "demo", policyRevision: "pol-002",
        capabilities: ["geo.read" as const] }) },
    ];
    for (const authority of changes) {
      expect(await renewGrant(await mintGrant(GRANT, SECRET, 1_000),
        { authority, secret: SECRET, issuer: GRANT }, () => false, 2_000)).toBeNull();
    }
  });
});
