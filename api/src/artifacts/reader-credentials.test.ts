import { describe, expect, it } from "vitest";
import { mintGrant, type GrantClaims } from "./preview-grant.js";
import { mintSessionCookie } from "./preview-session.js";
import { fingerprintReaderProfile } from "./reader-profile.js";
import { GRANT_SECRET, HOST, ISSUER, makeApp, request } from "./reader-test-fixture.js";

const SESSION_SECRET = "session-secret-32-bytes-long-pad!!";
const claims = (readerSub: string): GrantClaims => ({ ...ISSUER, host: HOST,
  artifactId: "123e4567-e89b-12d3-a456-426614174000", releaseId: "123e4567-e89b-12d3-a456-426614174001",
  readerSub, sessionId: "session-measure", profileName: "demo", policyRevision: "pol-001",
  profileFingerprint: fingerprintReaderProfile({ name: "demo", policyRevision: "pol-001",
    capabilities: ["geo.read", "signals.protected-read"] }) });
const session = (readerSub: string) => ({ sid: "session-measure", readerSub,
  artifactId: "123e4567-e89b-12d3-a456-426614174000", createdAt: 1_000, expiresAt: 900_000 });

describe("reader credential budgets", () => {
  it("should measure bounded cookies, grants and response headers for two fixture readers", async () => {
    let cookieMax = 0;
    let grantMax = 0;
    let responseHeaderMax = 0;
    for (const reader of ["reader-alice", "reader-bob"]) {
      const cookie = mintSessionCookie(session(reader), SESSION_SECRET);
      const grant = await mintGrant(claims(reader), GRANT_SECRET, 1_000);
      const response = await request(makeApp(), "/index.html", cookie.split(";")[0], grant);
      expect(response.status).toBe(200);
      let responseBytes = 2;
      response.headers.forEach((value, name) => { responseBytes += Buffer.byteLength(`${name}: ${value}\r\n`); });
      cookieMax = Math.max(cookieMax, Buffer.byteLength(cookie));
      grantMax = Math.max(grantMax, Buffer.byteLength(grant));
      responseHeaderMax = Math.max(responseHeaderMax, responseBytes);
    }
    expect(cookieMax).toBeLessThanOrEqual(4096);
    expect(grantMax).toBeLessThanOrEqual(4096);
    expect(responseHeaderMax).toBeLessThanOrEqual(16_384);
    console.log(JSON.stringify({ measurement: "two local fixture readers", cookieMax, grantMax, responseHeaderMax }));
  });
  it("should refuse oversized credentials before setting a cookie or returning a grant", async () => {
    expect(() => mintSessionCookie(session("x".repeat(5000)), SESSION_SECRET)).toThrow();
    await expect(mintGrant(claims("x".repeat(5000)), GRANT_SECRET, 1_000)).rejects.toThrow();
  });
});
