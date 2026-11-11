import { describe, expect, it } from "vitest";
import { createReaderContentApp } from "./content-serve.js";
import { createFixtureAuthority, fingerprintReaderProfile } from "./reader-profile.js";
import { createMemoryReleaseFiles } from "./release-files.js";
import { mintGrant } from "./preview-grant.js";
import { verifySession } from "../services/auth/session.js";
import { credentials, GRANT_SECRET, SESSION_SECRET, ISSUER, HOST } from "./reader-test-fixture.js";

const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE = "123e4567-e89b-12d3-a456-426614174001";
const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const APP_SECRET = "app-session-secret-for-relay-tests!";
const profile = { name: "demo", policyRevision: "pol-001",
  capabilities: ["geo.read", "signals.protected-read"] as const };

async function headers(sub = "reader-alice", basketScope = true) {
  const grant = await mintGrant({ ...ISSUER, host: HOST, artifactId: ARTIFACT, releaseId: RELEASE,
    readerSub: sub, sessionId: "session-1", profileName: profile.name,
    policyRevision: profile.policyRevision, profileFingerprint: fingerprintReaderProfile(profile),
    ...(basketScope ? { basketScope: true as const } : {}) }, GRANT_SECRET, 1_000);
  return { host: HOST, cookie: await credentials(sub, "session-1", 1_000, { basketScope }),
    "x-preview-grant": grant };
}

interface SeenCall { method: string; path: string; sub: string | null; body: string;
  idempotency: string | null; grantForwarded: boolean }

/** Application double: echoes the identity the relay minted, refuses one path as the app would. */
function appDouble(seen: SeenCall[]) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const cookie = request.headers.get("cookie") ?? "";
    const token = cookie.split("radar_session=")[1] ?? "";
    const session = token ? await verifySession(token, { sessionSecret: APP_SECRET, now: 1_000 }) : null;
    seen.push({ method: request.method, path: `${url.pathname}${url.search}`, sub: session?.sub ?? null,
      body: await request.text(), idempotency: request.headers.get("idempotency-key"),
      grantForwarded: request.headers.has("x-preview-grant") });
    if (url.pathname.endsWith("/personal/discard")) {
      return Response.json({ ok: false, error: { code: "workspace_forbidden" } }, { status: 403 });
    }
    return Response.json({ ok: true, seen: seen.length }, {
      headers: { "Set-Cookie": "radar_session=rotated; Path=/; HttpOnly" } });
  };
}

function setup(seen: SeenCall[], withRelay = true) {
  const app = createReaderContentApp({ contentBase: "pages.example.test", grantSecret: GRANT_SECRET,
    sessionSecret: SESSION_SECRET, issuer: ISSUER, authority: createFixtureAuthority(),
    now: () => 1_000, readOperation: async () => ({}),
    releaseFiles: createMemoryReleaseFiles([
      { artifactId: ARTIFACT, releaseId: RELEASE, path: "/index.html", body: "<!doctype html><html><body>x</body></html>" },
    ]),
    basketConsent: { hasLiveConsent: async () => true },
    ...(withRelay
      ? { relay: { dispatch: appDouble(seen), appOrigin: "https://app.example.test", appSessionSecret: APP_SECRET } }
      : {}) });
  return app;
}

const relayPath = `/__reader/app/api/v1/workspaces/${WORKSPACE}/signal-facets/by-city?excludePiia=1`;
const get = (app: ReturnType<typeof setup>, auth: Record<string, string>, path = relayPath) =>
  app.request(`https://${HOST}${path}`, { headers: auth as never });

describe("generic reader relay (/__reader/app/api/*)", () => {
  it("should relay a GET with the reader identity minted as an app session", async () => {
    const seen: SeenCall[] = [];
    const app = setup(seen);
    const res = await get(app, await headers());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, seen: 1 });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(seen).toEqual([{ method: "GET",
      path: `/api/v1/workspaces/${WORKSPACE}/signal-facets/by-city?excludePiia=1`,
      sub: "reader-alice", body: "", idempotency: null, grantForwarded: false }]);
  });

  it("should relay without basket consent (the app authorisations are the only limit)", async () => {
    const seen: SeenCall[] = [];
    const app = setup(seen);
    const res = await get(app, await headers("reader-alice", false));
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
  });

  it("should forward a classification write with body and idempotency key", async () => {
    const seen: SeenCall[] = [];
    const app = setup(seen);
    const auth = { ...(await headers()), "content-type": "application/json",
      "idempotency-key": "key-1", "sec-fetch-site": "same-origin" };
    const res = await app.request(
      `https://${HOST}/__reader/app/api/v1/workspaces/${WORKSPACE}/signal-facets/personal/select`,
      { method: "POST", headers: auth as never,
        body: JSON.stringify({ citySlug: "valleyfield", type: "Signal", id: "sig-1" }) });
    expect(res.status).toBe(200);
    expect(seen[0]).toMatchObject({ method: "POST", sub: "reader-alice", idempotency: "key-1",
      path: `/api/v1/workspaces/${WORKSPACE}/signal-facets/personal/select` });
    expect(JSON.parse(seen[0]!.body)).toEqual({ citySlug: "valleyfield", type: "Signal", id: "sig-1" });
  });

  it("should pass an application refusal through unchanged (refused by the app, not the relay)", async () => {
    const seen: SeenCall[] = [];
    const app = setup(seen);
    const auth = { ...(await headers()), "content-type": "application/json", "sec-fetch-site": "same-origin" };
    const res = await app.request(
      `https://${HOST}/__reader/app/api/v1/workspaces/${WORKSPACE}/signal-facets/personal/discard`,
      { method: "POST", headers: auth as never, body: "{}" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: { code: "workspace_forbidden" } });
    expect(seen).toHaveLength(1);
  });

  it("should relay any other /api/* path without an operation allowlist", async () => {
    const seen: SeenCall[] = [];
    const app = setup(seen);
    const res = await get(app, await headers(), "/__reader/app/api/v1/admin/users");
    expect(res.status).toBe(200);
    expect(seen[0]?.path).toBe("/api/v1/admin/users");
  });

  it("should refuse unauthenticated, foreign-origin writes and non-api paths without dispatching", async () => {
    const seen: SeenCall[] = [];
    const app = setup(seen);
    expect((await get(app, { host: HOST })).status).toBe(401);
    const forged = { ...(await headers()), "content-type": "application/json",
      origin: "https://evil.example.test" };
    const csrf = await app.request(
      `https://${HOST}/__reader/app/api/v1/workspaces/${WORKSPACE}/signal-facets/personal/select`,
      { method: "POST", headers: forged as never, body: "{}" });
    expect(csrf.status).toBe(403);
    expect(await csrf.json()).toEqual({ ok: false, error: "csrf_refused" });
    expect((await get(app, await headers(), "/__reader/app/assets/app.js")).status).toBe(404);
    expect(seen).toHaveLength(0);
  });

  it("should stay closed (503) when no relay dispatch is wired", async () => {
    const seen: SeenCall[] = [];
    const app = setup(seen, false);
    expect((await get(app, await headers())).status).toBe(503);
    expect(seen).toHaveLength(0);
  });
});
