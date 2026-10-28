import { expect, it } from "vitest";
import { createReaderContentApp } from "./content-serve.js";
import { createFixtureAuthority, fingerprintReaderProfile } from "./reader-profile.js";
import { mintSessionCookie } from "./preview-session.js";
import { mintGrant, verifyGrant } from "./preview-grant.js";
import { GRANT_SECRET, SESSION_SECRET, ISSUER } from "./reader-test-fixture.js";

const artifactId = "123e4567-e89b-12d3-a456-426614174000";
const releaseId = "123e4567-e89b-12d3-a456-426614174001";
const host = `${releaseId}.pinned.pages.example.test`, origin = `https://${host}`;
const resource = { ...ISSUER, host, artifactId, releaseId, readerSub: "reader-alice", sessionId: "sealed",
  profileName: "demo", policyRevision: "pol-001", profileFingerprint: fingerprintReaderProfile({
    name: "demo", policyRevision: "pol-001", capabilities: ["geo.read", "signals.protected-read"] }) };

function fixture() {
  let now = 1000, withdrawn = false;
  const authority = createFixtureAuthority();
  const app = createReaderContentApp({ contentBase: "pages.example.test", issuer: ISSUER,
    grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET, now: () => now,
    authority: { ...authority, getRights: async (...args) => withdrawn ? null : authority.getRights(...args) } });
  const cookie = (changed = {}) => mintSessionCookie({ sid: resource.sessionId, readerSub: resource.readerSub,
    artifactId, createdAt: 1000, expiresAt: 901000, resource, ...changed }, SESSION_SECRET).split(";")[0]!;
  const request = (headers = {}, session = cookie(), target = host) => app.request(`https://${target}/__reader/renew`, {
    method: "POST", headers: { host: target, cookie: session, origin: `https://${target}`, ...headers },
  });
  return { app, request, cookie, setNow: (value: number) => { now = value; }, withdraw: () => { withdrawn = true; } };
}

it("should renew a live grant and recover an expired grant using only a current sealed P on its pinned host", async () => {
  const f = fixture(), grant = await mintGrant(resource, GRANT_SECRET, 1000);
  f.setNow(41000);
  expect((await f.request({ "x-preview-grant": grant })).status).toBe(200);
  f.setNow(61000);
  expect((await f.request({ "x-preview-grant": grant })).status).toBe(401);
  const response = await f.request();
  expect(response.status).toBe(200);
  const renewed = (await response.json()).grant;
  expect(await verifyGrant(renewed, resource, GRANT_SECRET, 61000)).toMatchObject({ ...resource, expiresAtMs: 116000 });
  expect(response.headers.get("cache-control")).toContain("no-store");
  f.withdraw();
  expect((await f.request()).status).toBe(401);
});

it("should refuse cookie recovery from foreign origins, altered bindings and expired P", async () => {
  const f = fixture(); f.setNow(61000);
  expect((await f.request({ origin: "https://foreign.test" })).status).toBe(403);
  expect((await f.request({ origin: "" })).status).toBe(403);
  expect((await f.request({ "sec-fetch-site": "cross-site" })).status).toBe(403);
  expect((await f.request({}, "")).status).toBe(401);
  for (const changed of [{ resource: undefined }, { resource: { ...resource, readerSub: "reader-bob" } },
    { resource: { ...resource, sessionId: "other" } }, { resource: { ...resource, artifactId: releaseId } },
    { resource: { ...resource, policyRevision: "other" } }, { expiresAt: 60000 }]) {
    expect((await f.request({}, f.cookie(changed))).status).toBe(401);
  }
  expect((await f.request({}, f.cookie(), `${artifactId}.pages.example.test`)).status).toBe(401);
  expect((await f.request({}, f.cookie(), `${artifactId}.pinned.pages.example.test`)).status).toBe(401);
  expect((await f.request({ "x-preview-grant": "forged" })).status).toBe(401);
  expect((await f.request({ authorization: "Bearer publisher" })).status).toBe(400);
});
