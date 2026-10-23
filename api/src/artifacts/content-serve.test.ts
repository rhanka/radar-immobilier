import { describe, expect, it } from "vitest";
import { mintGrant } from "./preview-grant.js";
import { GRANT_SECRET, HOST, ISSUER, credentials, makeApp, request } from "./reader-test-fixture.js";

describe("authorized artifact content serving", () => {
  it("should refuse anonymous page and API access", async () => {
    const app = makeApp();
    for (const path of ["/index.html", "/__reader/api/geo.read.v1?collectionId=qc-zonage-valleyfield"]) {
      const res = await request(app, path);
      expect(res.status, path).toBe(401);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  it("should serve the pinned example to an authorized reader", async () => {
    const app = makeApp();
    const cookie = await credentials("reader-alice", "session-1", 1_000);
    const grant = await mintGrant(
      { ...ISSUER, host: HOST, artifactId: "123e4567-e89b-12d3-a456-426614174000", releaseId: "123e4567-e89b-12d3-a456-426614174001", readerSub: "reader-alice", sessionId: "session-1", profileName: "demo", policyRevision: "pol-001" },
      GRANT_SECRET,
      1_000,
    );
    const res = await request(app, "/index.html", cookie, grant);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.text()).toContain("Artifact reader example");
  });

  it("should distinguish two readers on the protected operation", async () => {
    const app = makeApp();
    const alice = await credentials("reader-alice", "session-a", 1_000);
    const grantAlice = await mintGrant(
      { ...ISSUER, host: HOST, artifactId: "123e4567-e89b-12d3-a456-426614174000", releaseId: "123e4567-e89b-12d3-a456-426614174001", readerSub: "reader-alice", sessionId: "session-a", profileName: "demo", policyRevision: "pol-001" },
      GRANT_SECRET,
      1_000,
    );
    const aliceRes = await request(app, "/__reader/api/signals.protected-read.v1?city=valleyfield", alice, grantAlice);
    expect(aliceRes.status).toBe(200);
    const aliceBody = (await aliceRes.json()) as { signals: { detail: string | null }[] };
    expect(aliceBody.signals).toHaveLength(2);

    const bob = await credentials("reader-bob", "session-b", 1_000);
    const grantBob = await mintGrant(
      { ...ISSUER, host: HOST, artifactId: "123e4567-e89b-12d3-a456-426614174000", releaseId: "123e4567-e89b-12d3-a456-426614174001", readerSub: "reader-bob", sessionId: "session-b", profileName: "demo", policyRevision: "pol-001" },
      GRANT_SECRET,
      1_000,
    );
    const bobBody = (await (await request(app, "/__reader/api/signals.protected-read.v1?city=valleyfield", bob, grantBob)).json()) as {
      signals: { detail: string | null }[];
    };
    expect(bobBody.signals).toHaveLength(1);
    expect(bobBody.signals[0]?.detail).toBeNull();
  });

  it("should fail the closed capability locally without disabling other operations", async () => {
    const app = makeApp();
    const cookie = await credentials("reader-alice", "session-1", 1_000);
    const grant = await mintGrant(
      { ...ISSUER, host: HOST, artifactId: "123e4567-e89b-12d3-a456-426614174000", releaseId: "123e4567-e89b-12d3-a456-426614174001", readerSub: "reader-alice", sessionId: "session-1", profileName: "demo", policyRevision: "pol-001" },
      GRANT_SECRET,
      1_000,
    );
    expect((await request(app, "/__reader/api/status.closed.v1", cookie, grant)).status).toBe(503);
    expect((await request(app, "/__reader/api/geo.read.v1?collectionId=qc-zonage-valleyfield", cookie, grant)).status).toBe(200);
  });

  it("should refuse non-GET methods on named operations", async () => {
    const app = makeApp();
    const cookie = await credentials("reader-alice", "session-1", 1_000);
    const grant = await mintGrant(
      { ...ISSUER, host: HOST, artifactId: "123e4567-e89b-12d3-a456-426614174000", releaseId: "123e4567-e89b-12d3-a456-426614174001", readerSub: "reader-alice", sessionId: "session-1", profileName: "demo", policyRevision: "pol-001" },
      GRANT_SECRET,
      1_000,
    );
    const res = await app.request(`http://${HOST}/__reader/api/geo.read.v1?grant=${grant}`, {
      method: "POST",
      headers: { host: HOST, cookie },
    });
    expect(res.status).toBe(405);
  });

  it("should bind grants to the bare host ignoring the numeric port", async () => {
    const app = makeApp();
    const cookie = await credentials("reader-alice", "session-1", 1_000);
    const grant = await mintGrant(
      { ...ISSUER, host: HOST, artifactId: "123e4567-e89b-12d3-a456-426614174000", releaseId: "123e4567-e89b-12d3-a456-426614174001", readerSub: "reader-alice", sessionId: "session-1", profileName: "demo", policyRevision: "pol-001" },
      GRANT_SECRET,
      1_000,
    );
    const res = await app.request(`http://${HOST}:5123/index.html?grant=${grant}`, {
      headers: { host: `${HOST}:5123`, cookie },
    });
    expect(res.status).toBe(200);
  });

  it("should refuse unknown operations, bad params, service workers and embed", async () => {
    const app = makeApp();
    const cookie = await credentials("reader-alice", "session-1", 1_000);
    const grant = await mintGrant(
      { ...ISSUER, host: HOST, artifactId: "123e4567-e89b-12d3-a456-426614174000", releaseId: "123e4567-e89b-12d3-a456-426614174001", readerSub: "reader-alice", sessionId: "session-1", profileName: "demo", policyRevision: "pol-001" },
      GRANT_SECRET,
      1_000,
    );
    expect((await request(app, "/__reader/api/nope.v9", cookie, grant)).status).toBe(404);
    expect((await request(app, "/__reader/api/geo.read.v1?collectionId=https://evil.example", cookie, grant)).status).toBe(400);
    expect((await request(app, "/sw.js", cookie, grant)).status).toBe(404);
    expect((await request(app, "/embed/123e4567-e89b-12d3-a456-426614174000", cookie, grant)).status).toBe(404);
  });

  it("should refuse forged grants, wrong sessions and expired grants", async () => {
    const app = makeApp(() => 200_000);
    const cookie = await credentials("reader-alice", "session-1", 1_000);
    const expired = await mintGrant(
      { ...ISSUER, host: HOST, artifactId: "123e4567-e89b-12d3-a456-426614174000", releaseId: "123e4567-e89b-12d3-a456-426614174001", readerSub: "reader-alice", sessionId: "session-1", profileName: "demo", policyRevision: "pol-001" },
      GRANT_SECRET,
      1_000,
    );
    expect((await request(app, "/index.html", cookie, expired)).status).toBe(401);
    expect((await request(app, "/index.html", cookie, "forged.grant.value")).status).toBe(401);
    const otherSession = await credentials("reader-alice", "session-2", 150_000);
    const grantSession1 = await mintGrant(
      { ...ISSUER, host: HOST, artifactId: "123e4567-e89b-12d3-a456-426614174000", releaseId: "123e4567-e89b-12d3-a456-426614174001", readerSub: "reader-alice", sessionId: "session-1", profileName: "demo", policyRevision: "pol-001" },
      GRANT_SECRET,
      150_000,
    );
    expect((await request(app, "/index.html", otherSession, grantSession1)).status).toBe(401);
  });
});
