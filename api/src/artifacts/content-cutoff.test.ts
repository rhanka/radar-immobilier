import { describe, expect, it, vi } from "vitest";
import { createReaderContentApp } from "./content-serve.js";
import { mintGrant } from "./preview-grant.js";
import { fingerprintReaderProfile } from "./reader-profile.js";
import { credentials, fixtureReaderDeps, GRANT_SECRET, HOST, ISSUER, request } from "./reader-test-fixture.js";

const FINGERPRINT = fingerprintReaderProfile({ name: "demo", policyRevision: "pol-001",
  capabilities: ["geo.read", "signals.protected-read"] });

function latch() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release: () => release() };
}

async function token() {
  return mintGrant({ ...ISSUER, host: HOST, artifactId: "123e4567-e89b-12d3-a456-426614174000",
    releaseId: "123e4567-e89b-12d3-a456-426614174001", readerSub: "reader-alice",
    sessionId: "session-1", profileName: "demo", policyRevision: "pol-001",
    profileFingerprint: FINGERPRINT }, GRANT_SECRET, 1_000);
}

describe("reader access after asynchronous waits", () => {
  it("should avoid invoking the API after authorization outlives its grant", async () => {
    let now = 1_000;
    const fixture = fixtureReaderDeps();
    const entered = latch();
    const blocked = latch();
    const readOperation = vi.fn(fixture.readOperation!);
    const authority = { ...fixture.authority!, getRights: async (sub: string, artifactId: string) => {
      entered.release();
      await blocked.promise;
      return fixture.authority!.getRights(sub, artifactId);
    } };
    const app = createReaderContentApp({ ...fixture, authority, readOperation, now: () => now,
      contentBase: "pages.example.test", grantSecret: GRANT_SECRET,
      sessionSecret: "session-secret-32-bytes-long-pad!!", issuer: ISSUER });
    const result = request(app, "/__reader/api/geo.read.v1", await credentials("reader-alice", "session-1", 1_000), await token());
    await entered.promise;
    now = 56_000;
    blocked.release();
    expect((await result).status).toBe(401);
    expect(readOperation).not.toHaveBeenCalled();
  });

  it.each(["expiry", "revocation"])("should withhold an API result after %s during the upstream wait", async (reason) => {
    let now = 1_000;
    let revoked = false;
    const entered = latch();
    const blocked = latch();
    const fixture = fixtureReaderDeps();
    const app = createReaderContentApp({ ...fixture, now: () => now, isRevoked: () => revoked,
      contentBase: "pages.example.test", grantSecret: GRANT_SECRET,
      sessionSecret: "session-secret-32-bytes-long-pad!!", issuer: ISSUER,
      readOperation: async () => { entered.release(); await blocked.promise;
        return { type: "FeatureCollection", features: [] }; } });
    const result = request(app, "/__reader/api/geo.read.v1", await credentials("reader-alice", "session-1", 1_000), await token());
    await entered.promise;
    if (reason === "expiry") now = 56_000;
    else revoked = true;
    blocked.release();
    expect((await result).status).toBe(401);
  });
});
