/**
 * A6 integration: authorized serving, named operations and isolation.
 * Real Hono app with synthetic fixtures; two readers, closed capability,
 * cookie/header size bounds and credential non-exposure.
 */
import { describe, expect, it } from "vitest";
import { createReaderContentApp } from "../../src/artifacts/content-serve.js";
import { servedBodyLeaksCredentials } from "../../src/artifacts/content-isolation.js";
import { mintGrant } from "../../src/artifacts/preview-grant.js";
import { mintSessionCookie } from "../../src/artifacts/preview-session.js";
import { fingerprintReaderProfile } from "../../src/artifacts/reader-profile.js";
import { fixtureReaderDeps } from "../../src/artifacts/reader-test-fixture.js";

const GRANT_SECRET = "grant-secret-32-bytes-long-padding!";
const SESSION_SECRET = "session-secret-32-bytes-long-pad!!";
const ISSUER = { issuer: "https://api.example.test", audience: "https://api.example.test/reader", tier: "preprod" };
const HOST = "123e4567-e89b-12d3-a456-426614174000.pages.example.test";

function app(now: () => number = () => 1_000) {
  return createReaderContentApp({
    ...fixtureReaderDeps(),
    contentBase: "pages.example.test",
    grantSecret: GRANT_SECRET,
    sessionSecret: SESSION_SECRET,
    issuer: ISSUER,
    now,
  });
}

async function authHeaders(readerSub: string, sessionId: string, nowMs: number): Promise<Record<string, string>> {
  const grant = await mintGrant(
    { ...ISSUER, host: HOST, artifactId: "123e4567-e89b-12d3-a456-426614174000", releaseId: "123e4567-e89b-12d3-a456-426614174001", readerSub, sessionId, profileName: "demo", policyRevision: "pol-001", profileFingerprint: fingerprintReaderProfile({ name: "demo", policyRevision: "pol-001", capabilities: ["geo.read", "signals.protected-read"] }) },
    GRANT_SECRET,
    nowMs,
  );
  const cookie = mintSessionCookie(
    { sid: sessionId, readerSub, artifactId: "123e4567-e89b-12d3-a456-426614174000", createdAt: nowMs, expiresAt: nowMs + 900_000 },
    SESSION_SECRET,
  ).split(";")[0] as string;
  return { cookie, "x-preview-grant": grant };
}

async function get(path: string, headers: Record<string, string>): Promise<Response> {
  return app().request(`http://${HOST}${path}`, { headers: { host: HOST, ...headers } });
}

describe("artifacts reader operations and isolation", () => {
  it("should serve public Geo to both readers", async () => {
    for (const reader of ["reader-alice", "reader-bob"]) {
      const res = await get(
        "/__reader/api/geo.read.v1?collectionId=qc-zonage-valleyfield&limit=2",
        await authHeaders(reader, `session-${reader}`, 1_000),
      );
      expect(res.status, reader).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      const body = (await res.json()) as { type: string; features: unknown[] };
      expect(body.type).toBe("FeatureCollection");
      expect(body.features.length).toBeGreaterThan(0);
    }
  });

  it("should distinguish readers on the protected read", async () => {
    const alice = (await (await get(
      "/__reader/api/signals.protected-read.v1?city=valleyfield",
      await authHeaders("reader-alice", "session-a", 1_000),
    )).json()) as { signals: { detail: string | null }[] };
    const bob = (await (await get(
      "/__reader/api/signals.protected-read.v1?city=valleyfield",
      await authHeaders("reader-bob", "session-b", 1_000),
    )).json()) as { signals: { detail: string | null }[] };
    expect(alice.signals.length).toBeGreaterThan(bob.signals.length);
    expect(bob.signals.every((s) => s.detail === null)).toBe(true);
  });

  it("should keep the closed capability local and the page available", async () => {
    const headers = await authHeaders("reader-alice", "session-a", 1_000);
    expect((await get("/__reader/api/status.closed.v1", headers)).status).toBe(503);
    expect((await get("/index.html", headers)).status).toBe(200);
  });

  it("should refuse service workers, embed and leaked credentials with bounded headers", async () => {
    const headers = await authHeaders("reader-alice", "session-a", 1_000);
    for (const path of ["/sw.js", "/service-worker.js", "/embed/123e4567-e89b-12d3-a456-426614174000"]) {
      expect((await get(path, headers)).status, path).toBe(404);
    }
    const page = await get("/index.html", headers);
    const body = await page.text();
    expect(servedBodyLeaksCredentials(body)).toBe(false);
    expect(body.length).toBeLessThan(16_384);
    expect(headers.cookie.length).toBeLessThan(4_096);
  });
});
