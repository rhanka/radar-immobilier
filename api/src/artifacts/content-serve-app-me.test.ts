import { describe, expect, it, vi } from "vitest";
import { createReaderContentApp, type ContentServeDeps } from "./content-serve.js";
import { createFixtureAuthority, fingerprintReaderProfile } from "./reader-profile.js";
import { createMemoryReleaseFiles } from "./release-files.js";
import { mintGrant } from "./preview-grant.js";
import { deriveUserRef } from "./reader-me.js";
import { credentials, GRANT_SECRET, SESSION_SECRET, ISSUER, HOST } from "./reader-test-fixture.js";

const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE = "123e4567-e89b-12d3-a456-426614174001";
const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const profile = { name: "demo", policyRevision: "pol-001",
  capabilities: ["geo.read", "signals.protected-read"] as const };

async function headers(sub = "reader-alice", basketScope = false) {
  const grant = await mintGrant({ ...ISSUER, host: HOST, artifactId: ARTIFACT, releaseId: RELEASE,
    readerSub: sub, sessionId: "session-1", profileName: profile.name,
    policyRevision: profile.policyRevision, profileFingerprint: fingerprintReaderProfile(profile),
    ...(basketScope ? { basketScope: true as const } : {}) }, GRANT_SECRET, 1_000);
  return { host: HOST, cookie: await credentials(sub, "session-1", 1_000, { basketScope }),
    "x-preview-grant": grant };
}

function setup(overrides: Partial<ContentServeDeps> = {}, nowMs = 1_000) {
  const read = vi.fn(async (): Promise<unknown> => ({ ok: true, workspaces: [] }));
  const app = createReaderContentApp({ contentBase: "pages.example.test", grantSecret: GRANT_SECRET,
    sessionSecret: SESSION_SECRET, issuer: ISSUER, authority: createFixtureAuthority(),
    now: () => nowMs, readOperation: read,
    releaseFiles: createMemoryReleaseFiles([
      { artifactId: ARTIFACT, releaseId: RELEASE, path: "/index.html", body: "<!doctype html><html><body>x</body></html>" },
    ]), ...overrides });
  return { app, read };
}

const mePath = "/__reader/api/app.me.v1";
const get = (app: ReturnType<typeof setup>["app"], query = "", auth: Record<string, string> = { host: HOST }) =>
  app.request(`https://${HOST}${mePath}${query}`, { headers: auth as never });

function errorCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  return null;
}

describe("app.me.v1 dispatch (§2.3, §15)", () => {
  it("should serve the exact contract before basket consent without any business call", async () => {
    // The consent gate denies everything: app.me still boots (§2.3, no Gate B).
    const { app, read } = setup({ basketConsent: { hasLiveConsent: async () => false } });
    const auth = await headers("reader-alice", false);
    const res = await get(app, "", auth);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ authenticated: true,
      user: { sub: deriveUserRef(SESSION_SECRET, ARTIFACT, "reader-alice"),
        name: "Lecteur", status: "approved" } });
    expect(read).not.toHaveBeenCalled();
    const gated = await app.request(`https://${HOST}/__reader/api/workspaces.list.v1`,
      { headers: auth as never });
    expect(gated.status).toBe(403);
  });

  it("should refuse missing grants, forged authority and bad params before any business call", async () => {
    const { app, read } = setup();
    const valid = await headers();
    const refusals: Array<[Response, number, string]> = [];
    refusals.push([await get(app), 401, "unauthenticated"]);
    refusals.push([await get(app, "", { ...valid, "x-preview-grant": "forged" }), 401, "unauthenticated"]);
    refusals.push([await get(app, "", { ...valid, "x-reader-sub": "publisher" } as never), 400, "invalid_authority"]);
    for (const query of ["?unexpected=1", "?unexpected=1&unexpected=2", "?grant=a&grant=b"]) {
      const expected = query.startsWith("?grant=") ? 401 : 400;
      refusals.push([await get(app, query, valid), expected,
        expected === 401 ? "unauthenticated" : "invalid_query"]);
    }
    for (const [res, status, code] of refusals) {
      expect(res.status).toBe(status);
      expect(errorCode(await res.json())).toBe(code);
    }
    expect((await app.request(`https://${HOST}${mePath}`, { method: "POST", headers: valid as never })).status).toBe(405);
    expect(read).not.toHaveBeenCalled();
  });

  it("should separate readers with no correlatable identity", async () => {
    const { app } = setup();
    const alice = await (await get(app, "", await headers("reader-alice"))).json() as {
      user: { sub: string; name: string; status: string } };
    const bob = await (await get(app, "", await headers("reader-bob"))).json() as typeof alice;
    expect(alice.user.sub).not.toBe(bob.user.sub);
    for (const user of [alice.user, bob.user]) {
      expect(user.name).toBe("Lecteur");
      expect(user.status).toBe("approved");
    }
  });

  it("should enforce the §13 budget with Retry-After", async () => {
    const { app, read } = setup();
    const valid = await headers();
    for (let call = 0; call < 5; call += 1) expect((await get(app, "", valid)).status).toBe(200);
    const limited = await get(app, "", valid);
    expect(limited.status).toBe(429);
    expect(errorCode(await limited.json())).toBe("rate_limited");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(read).not.toHaveBeenCalled();
  });

  it("should discard the response after an authorization change", async () => {
    let calls = 0;
    const authority = { ...createFixtureAuthority(), getAuthorizationVersion: async () => (++calls <= 4 ? "v1" : "v2") };
    const { app, read } = setup({ authority });
    const res = await get(app, "", await headers());
    expect(res.status).toBe(401);
    expect(errorCode(await res.json())).toBe("unauthenticated");
    expect(read).not.toHaveBeenCalled();
  });

  it("should serve the §3.3 adapter shape and fail closed on account details", async () => {
    const { app, read } = setup();
    const valid = await headers("reader-alice", true);
    const adapted = { ok: true, workspaces: [{
      id: WORKSPACE, slug: "team", label: "Team", signals: { availability: { state: "open" } },
      workspace: { id: WORKSPACE, slug: "team", label: "Team" },
      moderateArchive: false, manageMembers: false }] };
    read.mockResolvedValue(adapted);
    const res = await app.request(`https://${HOST}/__reader/api/workspaces.list.v1`,
      { headers: valid as never });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(adapted);
    const legacy = { ok: true, workspaces: [{
      id: WORKSPACE, slug: "team", label: "Team", accountId: "private",
      signals: { availability: { state: "open" } } }] };
    read.mockResolvedValue(legacy);
    const refused = await app.request(`https://${HOST}/__reader/api/workspaces.list.v1`,
      { headers: valid as never });
    expect(refused.status).toBe(500);
    expect(JSON.stringify(await refused.json())).not.toContain("private");
  });
});
