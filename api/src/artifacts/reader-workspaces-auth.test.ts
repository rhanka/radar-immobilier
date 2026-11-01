import { describe, expect, it, vi } from "vitest";
import { WorkspaceError } from "../services/workspaces/types.js";
import { createReaderContentApp, type ContentServeDeps } from "./content-serve.js";
import { createFixtureAuthority, fingerprintReaderProfile } from "./reader-profile.js";
import { mintGrant } from "./preview-grant.js";
import { credentials, GRANT_SECRET, SESSION_SECRET, ISSUER, HOST } from "./reader-test-fixture.js";

const path = "/__reader/api/workspaces.list.v1";
const profile = { name: "demo", policyRevision: "pol-001", capabilities: ["geo.read", "signals.protected-read"] as const };
async function headers(sub = "reader-alice", issuedAt = 1_000, sid = "session") {
  return { host: HOST, cookie: await credentials(sub, sid, issuedAt), "x-preview-grant": await mintGrant({
    ...ISSUER, host: HOST, artifactId: "123e4567-e89b-12d3-a456-426614174000",
    releaseId: "123e4567-e89b-12d3-a456-426614174001", readerSub: sub, sessionId: sid,
    profileName: profile.name, policyRevision: profile.policyRevision, profileFingerprint: fingerprintReaderProfile(profile),
  }, GRANT_SECRET, issuedAt) };
}
function setup(overrides: Partial<ContentServeDeps> = {}) {
  const read = vi.fn(async () => ({ ok: true, workspaces: [] }));
  const app = createReaderContentApp({ contentBase: "pages.example.test", grantSecret: GRANT_SECRET,
    sessionSecret: SESSION_SECRET, issuer: ISSUER, authority: createFixtureAuthority(), now: () => 1_000,
    readOperation: read, ...overrides });
  return { app, read, get: async (query = "", auth?: Awaited<ReturnType<typeof headers>>) =>
    app.request(`https://${HOST}${path}${query}`, { headers: auth ?? await headers() }) };
}
async function failure(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({ ok: false, error: { code }, requestId: expect.any(String) });
}

describe("workspace discovery H5 authorization", () => {
  it("should require a matching session and a current signed grant", async () => {
    const f = setup();
    const valid = await headers();
    for (const auth of [{ host: HOST }, { ...valid, "x-preview-grant": "forged" },
      { ...valid, cookie: await credentials("reader-bob", "session", 1_000) }, await headers("reader-alice", -100_000)]) {
      await failure(await f.get("", auth as typeof valid), 401, "unauthenticated");
    }
    expect(f.read).not.toHaveBeenCalled();
  });

  it("should refuse unapproved readers, missing capabilities and revoked sessions", async () => {
    const authority = createFixtureAuthority();
    for (const [overrides, code] of [
      [{ authority: { ...authority, getRights: async () => null } }, "unauthenticated"],
      [{ authority: { ...authority, getRights: async (readerSub: string, artifactId: string) => ({
        readerSub, artifactId, approved: true, capabilities: [] }) } }, "capability_required"],
      [{ isRevoked: () => true }, "unauthenticated"],
    ] as const) {
      const f = setup(overrides);
      await failure(await f.get(), code === "capability_required" ? 403 : 401, code);
      expect(f.read).not.toHaveBeenCalled();
    }
    const f = setup();
    await failure(await f.get("", await headers("reader-mallory")), 401, "unauthenticated");
    expect(f.read).not.toHaveBeenCalled();
  });

  it("should reject identity selection, unknown queries and writes before dispatch", async () => {
    const f = setup();
    for (const query of ["?workspaceId=foreign", "?readerSub=publisher", "?x=1&x=2", "?grant=a&grant=b"]) {
      const response = await f.get(query);
      await failure(response, query.startsWith("?grant=") ? 401 : 400,
        query.startsWith("?grant=") ? "unauthenticated" : "invalid_query");
    }
    await failure(await f.get("", { ...await headers(), "x-reader-sub": "publisher" } as never), 400, "invalid_query");
    expect((await f.app.request(`https://${HOST}${path}`, { method: "POST", headers: await headers() })).status).toBe(405);
    expect(f.read).not.toHaveBeenCalled();
  });

  it("should preserve typed workspace errors and discard results after authorization changes", async () => {
    const f = setup();
    f.read.mockRejectedValue(new WorkspaceError(403, "account_not_approved"));
    await failure(await f.get(), 403, "account_not_approved");
    let version = "v1";
    const raced = setup({ authority: { ...createFixtureAuthority(), getAuthorizationVersion: async () => version } });
    raced.read.mockImplementation(async () => { version = "v2"; return { ok: true, workspaces: [] }; });
    await failure(await raced.get(), 401, "unauthenticated");
  });

  it("should use a renewed grant and return a valid private discovery response", async () => {
    const f = setup();
    const auth = await headers();
    const renewed = await f.app.request(`https://${HOST}/__reader/renew`, { method: "POST", headers: auth });
    expect(renewed.status).toBe(200);
    const response = await f.get("", { ...auth, "x-preview-grant": (await renewed.json()).grant });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, workspaces: [] });
    expect(f.read).toHaveBeenCalledWith("workspaces.list.v1", {}, expect.objectContaining({ readerSub: "reader-alice" }));
  });
});
