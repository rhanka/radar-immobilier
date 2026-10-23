import { describe, expect, it, vi } from "vitest";
import { createReaderContentApp } from "./content-serve.js";
import { mintGrant } from "./preview-grant.js";
import { fingerprintReaderProfile } from "./reader-profile.js";
import { credentials, fixtureReaderDeps, GRANT_SECRET, HOST, ISSUER, request, SESSION_SECRET } from "./reader-test-fixture.js";

describe("content authority fences", () => {
  for (const op of ["geo.read.v1", "signals.protected-read.v1"] as const) {
    for (const phase of ["before invocation", "before response"] as const) {
      it.each(["version", "expiry", "revocation", "missing", "outage"] as const)(
        `should close ${op} on %s ${phase}`, async (change) => {
          const fixture = fixtureReaderDeps();
          let reads = 0;
          let racing = false;
          let now = 1_000;
          let revoked = false;
          let version = "v1";
          // Outer authorization brackets adaptation (four reads); the next
          // fences precede invocation and response respectively.
          const boundary = phase === "before invocation" ? 5 : 6;
          const authority = { ...fixture.authority!, getAuthorizationVersion: async () => {
            await Promise.resolve();
            if (racing && ++reads === boundary) {
              if (change === "version") version = "v2";
              if (change === "expiry") now = 56_000;
              if (change === "revocation") revoked = true;
              if (change === "missing") return null;
              if (change === "outage") throw new Error("Synthetic authority outage");
            }
            return version;
          } };
          const upstream = vi.fn(fixture.readOperation!);
          const app = createReaderContentApp({ ...fixture, authority, readOperation: upstream,
            contentBase: "pages.example.test", grantSecret: GRANT_SECRET,
            sessionSecret: SESSION_SECRET, issuer: ISSUER, now: () => now, isRevoked: () => revoked });
          const cookie = await credentials("reader-alice", "session-1", now);
          const grant = await mintGrant({ ...ISSUER, host: HOST,
            artifactId: "123e4567-e89b-12d3-a456-426614174000",
            releaseId: "123e4567-e89b-12d3-a456-426614174001", readerSub: "reader-alice",
            sessionId: "session-1", profileName: "demo", policyRevision: "pol-001",
            profileFingerprint: fingerprintReaderProfile({ name: "demo", policyRevision: "pol-001",
              capabilities: ["geo.read", "signals.protected-read"] }) }, GRANT_SECRET, now);
          expect((await request(app, `/__reader/api/${op}`, cookie, grant)).status).toBe(200);
          upstream.mockClear();
          racing = true;
          expect((await request(app, `/__reader/api/${op}`, cookie, grant)).status).toBe(401);
          expect(upstream).toHaveBeenCalledTimes(phase === "before invocation" ? 0 : 1);
        });
    }
  }
});
