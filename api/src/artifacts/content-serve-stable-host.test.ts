/**
 * Stable-host reader session (P0 #998 regression).
 *
 * Since I2 the exchange/session is minted on the stable ARTIFACT host, but
 * `authorized()` only accepted a sealed session when
 * `sealed.releaseId === host label`. Every cookie-only sub-resource on the
 * stable host (app.js, app.css, tiles, …) therefore answered 401 while the
 * `?grant=` document load worked. This file reproduces the exact browser
 * flow — stable link → exchange → cookie-only sub-resources — and pins the
 * surrounding contract (exact host, cross-artifact, republish).
 */
import { describe, expect, it } from "vitest";
import { createReaderContentApp } from "./content-serve.js";
import { createReaderOpening } from "./reader-opening.js";
import { fingerprintReaderProfile, type AuthorityReader } from "./reader-profile.js";
import { createMemoryReleaseFiles } from "./release-files.js";
import { mintSessionCookie } from "./preview-session.js";
import { mintGrant } from "./preview-grant.js";
import { TILE_PATH_PREFIX, TileProxy } from "./tile-proxy.js";
import type { PreviewTicket } from "./preview-tickets.js";
import type { SharedReaderTickets } from "./reader-tickets.js";
import type { AuthConfig } from "../config.js";
import { GRANT_SECRET, SESSION_SECRET, ISSUER } from "./reader-test-fixture.js";

const BASE = "pages.example.test";
const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE1 = "123e4567-e89b-12d3-a456-426614174001";
const RELEASE2 = "123e4567-e89b-12d3-a456-426614174002";
const OTHER = "223e4567-e89b-12d3-a456-426614174000";
const STABLE_HOST = `${ARTIFACT}.${BASE}`;
const EXACT_HOST1 = `${RELEASE1}.${BASE}`;
const OTHER_STABLE_HOST = `${OTHER}.${BASE}`;
const BINDING = "a".repeat(64);
const TICKET1 = "b".repeat(64);

const PROFILE = { name: "demo", policyRevision: "pol-001",
  capabilities: ["geo.read", "signals.protected-read"] as const };
const FINGERPRINT = fingerprintReaderProfile({ ...PROFILE, capabilities: [...PROFILE.capabilities] });

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

function mutableAuthority() {
  let current = RELEASE1;
  const authority: AuthorityReader = {
    getAuthorizationVersion: async (id) => (id === ARTIFACT ? `v:${current}` : null),
    getContentOrigin: async (id) => (id === ARTIFACT ? `https://${STABLE_HOST}` : null),
    getRelease: async (id, releaseId) => {
      if (id !== ARTIFACT) return null;
      if (releaseId === undefined) return { artifactId: ARTIFACT, releaseId: current, authorSub: "author-alice" };
      return releaseId === RELEASE1 || releaseId === RELEASE2
        ? { artifactId: ARTIFACT, releaseId, authorSub: "author-alice" } : null;
    },
    getProfile: async (id) => (id === ARTIFACT ? { ...PROFILE, capabilities: [...PROFILE.capabilities] } : null),
    getRights: async (readerSub, id) => (id === ARTIFACT && (readerSub === "reader-alice" || readerSub === "reader-bob")
      ? { readerSub, artifactId: ARTIFACT, approved: true, capabilities: [...PROFILE.capabilities] } : null),
  };
  return { authority, republish: () => { current = RELEASE2; } };
}

function ticket(ticketId: string, releaseId: string): PreviewTicket {
  return { browserBinding: BINDING, ticket: ticketId, origin: `https://${STABLE_HOST}`,
    artifactId: ARTIFACT, releaseId, profileName: PROFILE.name, policyRevision: PROFILE.policyRevision,
    profileFingerprint: FINGERPRINT, readerSub: "reader-alice", returnTarget: "/",
    expiresAt: Date.now() + 600_000 };
}

function stubFetch() {
  return (async () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
    status: 200, headers: { "content-type": "image/jpeg" } })) as unknown as typeof fetch;
}

function contentApp(authority: AuthorityReader) {
  return createReaderContentApp({ contentBase: BASE, issuer: ISSUER,
    grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET,
    authority,
    readOperation: async (op, params, context) => {
      if (op === "geo.read.v1") return { type: "FeatureCollection", features: [] };
      return { city: "valleyfield", reader: context.readerSub, signals: [] };
    },
    releaseFiles: createMemoryReleaseFiles([
      { artifactId: ARTIFACT, releaseId: RELEASE1, path: "/index.html", body: "<!doctype html><body>r1</body>" },
      { artifactId: ARTIFACT, releaseId: RELEASE1, path: "/app.js", body: "release-1 app.js" },
      { artifactId: ARTIFACT, releaseId: RELEASE1, path: "/app.css", body: "release-1 app.css" },
      { artifactId: ARTIFACT, releaseId: RELEASE2, path: "/index.html", body: "<!doctype html><body>r2</body>" },
      { artifactId: ARTIFACT, releaseId: RELEASE2, path: "/app.js", body: "release-2 app.js" },
      { artifactId: ARTIFACT, releaseId: RELEASE2, path: "/app.css", body: "release-2 app.css" },
    ]),
    tileProxy: new TileProxy({ fetchImpl: stubFetch() }),
  });
}

function sealedCookie(host: string, releaseId: string, artifactId = ARTIFACT,
  readerSub = "reader-alice", sid = "session-stable"): string {
  const resource = { ...ISSUER, host, artifactId, releaseId, readerSub, sessionId: sid,
    profileName: PROFILE.name, policyRevision: PROFILE.policyRevision, profileFingerprint: FINGERPRINT };
  const now = Date.now();
  return mintSessionCookie({ sid, readerSub, artifactId, createdAt: now,
    expiresAt: now + 900_000, resource }, SESSION_SECRET).split(";")[0]!;
}

describe("stable artifact host sessions", () => {
  it("serves cookie-only sub-resources after a stable-link exchange", async () => {
    const { authority } = mutableAuthority();
    const live = new Map([[TICKET1, ticket(TICKET1, RELEASE1)]]);
    const tickets = {
      mint: async () => { throw new Error("unused"); },
      consume: async (id: string) => {
        const hit = live.get(id) ?? null;
        if (hit) live.delete(id);
        return hit;
      },
    } as unknown as SharedReaderTickets;
    const { content } = createReaderOpening({ auth: AUTH, contentBase: BASE, authority,
      tickets, issuer: ISSUER, grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET });
    const exchanged = await content.request(`https://${STABLE_HOST}/__reader/exchange?ticket=${TICKET1}`, {
      headers: { host: STABLE_HOST, cookie: `__Host-preview-init=${BINDING}` },
    });
    expect(exchanged.status).toBe(303);
    const location = exchanged.headers.get("location")!;
    expect(location).toContain("grant=");
    const grant = new URL(location, `https://${STABLE_HOST}`).searchParams.get("grant")!;
    const session = exchanged.headers.getSetCookie()
      .find((entry) => entry.startsWith("__Host-preview-session="))!.split(";")[0]!;

    const app = contentApp(authority);
    const get = (path: string, target = STABLE_HOST, cookie: string | undefined = session, extra: Record<string, string> = {}) =>
      app.request(`https://${target}${path}`, { headers: { host: target, ...(cookie ? { cookie } : {}), ...extra } });

    // The P0: sub-resources carry no grant, only the sealed session cookie.
    expect((await get("/app.js")).status).toBe(200);
    expect(await (await get("/app.js")).text()).toBe("release-1 app.js");
    expect((await get("/app.css")).status).toBe(200);
    expect((await get(`${TILE_PATH_PREFIX}/12/1204/1469`)).status).toBe(200);
    // The grant bootstrap still works on the stable host: a presented grant
    // serves the document, a cookie-only document load mints one via 303.
    const doc = await get(`/?grant=${encodeURIComponent(grant)}`);
    expect(doc.status).toBe(200);
    expect(await doc.text()).toContain("r1");
    const boot = await app.request(`https://${STABLE_HOST}/`, {
      headers: { host: STABLE_HOST, cookie: session },
    });
    expect(boot.status).toBe(303);
    expect(boot.headers.get("location")).toContain("grant=");
    // Reader APIs accept the stable-host grant.
    const api = await get("/__reader/api/geo.read.v1?collectionId=qc-zonage-valleyfield",
      STABLE_HOST, session, { "x-preview-grant": grant });
    expect(api.status).toBe(200);
  });

  it("keeps serving the exact release host", async () => {
    const { authority } = mutableAuthority();
    const app = contentApp(authority);
    const cookie = sealedCookie(EXACT_HOST1, RELEASE1, ARTIFACT, "reader-alice", "session-exact");
    const res = await app.request(`https://${EXACT_HOST1}/app.js`, {
      headers: { host: EXACT_HOST1, cookie },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("release-1 app.js");
  });

  it("refuses cross-artifact sessions indistinguishably", async () => {
    const { authority } = mutableAuthority();
    const app = contentApp(authority);
    const cookie = sealedCookie(STABLE_HOST, RELEASE1);
    const bodies = new Set<string>();
    for (const target of [OTHER_STABLE_HOST, `999e4567-e89b-12d3-a456-426614174009.${BASE}`]) {
      const res = await app.request(`https://${target}/app.js`, {
        headers: { host: target, cookie },
      });
      expect(res.status, target).toBe(401);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      bodies.add(await res.text());
    }
    // One shape, no leak about which artifact or release exists.
    expect(bodies.size).toBe(1);
    expect([...bodies][0]).toBe(JSON.stringify({ error: "unauthenticated" }));
  });

  it("fails the stale stable session closed on republish until a clean re-exchange", async () => {
    const { authority, republish } = mutableAuthority();
    const app = contentApp(authority);
    const oldCookie = sealedCookie(STABLE_HOST, RELEASE1, ARTIFACT, "reader-alice", "session-old");
    const oldGrant = await mintGrant({ ...ISSUER, host: STABLE_HOST, artifactId: ARTIFACT,
      releaseId: RELEASE1, readerSub: "reader-alice", sessionId: "session-old",
      profileName: PROFILE.name, policyRevision: PROFILE.policyRevision,
      profileFingerprint: FINGERPRINT }, GRANT_SECRET, Date.now());

    const stable = (path: string, cookie?: string, grant?: string, target = STABLE_HOST) =>
      app.request(`https://${target}${path}${grant ? `?grant=${encodeURIComponent(grant)}` : ""}`, {
        headers: { host: target, ...(cookie ? { cookie } : {}) },
      });
    expect((await stable("/app.js", oldCookie)).status).toBe(200);

    republish();

    // Stale sealed session and stale grant fail closed on the stable host…
    expect((await stable("/app.js", oldCookie)).status).toBe(401);
    expect((await stable("/app.js", undefined, oldGrant)).status).toBe(401);
    expect((await stable("/__reader/api/geo.read.v1?collectionId=qc-zonage-valleyfield", oldCookie, oldGrant)).status).toBe(401);
    expect((await app.request(`https://${STABLE_HOST}/__reader/renew`, { method: "POST",
      headers: { host: STABLE_HOST, cookie: oldCookie, "x-preview-grant": oldGrant } })).status).toBe(401);
    // …while the exact host keeps its pinned release for old tabs…
    const pinned = await app.request(`https://${EXACT_HOST1}/app.js`, {
      headers: { host: EXACT_HOST1, cookie: sealedCookie(EXACT_HOST1, RELEASE1, ARTIFACT, "reader-alice", "session-old") },
    });
    expect(pinned.status).toBe(200);
    expect(await pinned.text()).toBe("release-1 app.js");
    // …and a clean re-exchange serves the new release.
    const freshCookie = sealedCookie(STABLE_HOST, RELEASE2, ARTIFACT, "reader-alice", "session-new");
    const fresh = await stable("/app.js", freshCookie);
    expect(fresh.status).toBe(200);
    expect(await fresh.text()).toBe("release-2 app.js");
    const recovered = await app.request(`https://${STABLE_HOST}/__reader/renew`, { method: "POST",
      headers: { host: STABLE_HOST, cookie: freshCookie, origin: `https://${STABLE_HOST}` } });
    expect(recovered.status).toBe(200);
  });
});
