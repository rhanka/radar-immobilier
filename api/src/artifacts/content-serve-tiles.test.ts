/**
 * I-10B tile mount tests through the real content host (pass-wonder §4).
 * New file on purpose: no existing content-serve test is edited, so the
 * I2-partage rebase keeps this hunk separate.
 */
import { describe, expect, it } from "vitest";
import { mintGrant } from "./preview-grant.js";
import { fingerprintReaderProfile } from "./reader-profile.js";
import { createReaderContentApp } from "./content-serve.js";
import { TILE_CLIENT_MAX_AGE_SECONDS, TILE_PATH_PREFIX, TileProxy } from "./tile-proxy.js";
import {
  GRANT_SECRET,
  HOST,
  ISSUER,
  SESSION_SECRET,
  credentials,
  fixtureReaderDeps,
  request,
} from "./reader-test-fixture.js";

const FINGERPRINT = fingerprintReaderProfile({
  name: "demo",
  policyRevision: "pol-001",
  capabilities: ["geo.read", "signals.protected-read"],
});

const TILE = `${TILE_PATH_PREFIX}/12/1204/1469`;
const LABELS = `${TILE_PATH_PREFIX}/labels/12/1204/1469`;

const JPEG: Uint8Array<ArrayBuffer> = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]);
const PNG: Uint8Array<ArrayBuffer> = new Uint8Array(
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);

function stubTileFetch() {
  const calls: string[] = [];
  const seen: RequestInit[] = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    calls.push(String(url));
    seen.push(init ?? {});
    const target = String(url);
    if (target.includes("CBMT_TXT_3857")) {
      return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
    }
    return new Response(JPEG, { status: 200, headers: { "content-type": "image/jpeg" } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, seen };
}

function makeTileApp(fetchImpl: typeof fetch) {
  const fixture = fixtureReaderDeps();
  return createReaderContentApp({
    ...fixture,
    contentBase: "pages.example.test",
    grantSecret: GRANT_SECRET,
    sessionSecret: SESSION_SECRET,
    issuer: ISSUER,
    tileProxy: new TileProxy({ fetchImpl }),
    now: () => 1_000,
  });
}

async function aliceGrant(): Promise<string> {
  return mintGrant(
    {
      ...ISSUER,
      host: HOST,
      artifactId: "123e4567-e89b-12d3-a456-426614174000",
      releaseId: "123e4567-e89b-12d3-a456-426614174001",
      readerSub: "reader-alice",
      sessionId: "session-1",
      profileName: "demo",
      policyRevision: "pol-001",
      profileFingerprint: FINGERPRINT,
    },
    GRANT_SECRET,
    1_000,
  );
}

describe("I-10B tile mount on the content origin", () => {
  it("serves real tile bytes through the proxy on the frozen path", async () => {
    const { fetchImpl, calls, seen } = stubTileFetch();
    const app = makeTileApp(fetchImpl);
    const cookie = await credentials("reader-alice", "session-1", 1_000);
    const grant = await aliceGrant();

    const res = await request(app, TILE, cookie, grant);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe(`private, max-age=${TILE_CLIENT_MAX_AGE_SECONDS}`);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("servicesmatriciels.mern.gouv.qc.ca");
    expect(calls[0]).not.toContain("?");
    const sent = new Headers((seen[0]?.headers ?? {}) as HeadersInit);
    expect(sent.has("cookie")).toBe(false);

    // A second read of the same tile (another artifact origin sharing the
    // server cache) costs no second upstream call.
    expect((await request(app, TILE, cookie, grant)).status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it("serves the fallback labels overlay one segment deeper", async () => {
    const { fetchImpl, calls } = stubTileFetch();
    const app = makeTileApp(fetchImpl);
    const cookie = await credentials("reader-alice", "session-1", 1_000);
    const grant = await aliceGrant();
    const res = await request(app, LABELS, cookie, grant);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(calls[0]).toContain("CBMT_TXT_3857");
  });

  it("refuses forged paths with zero upstream calls", async () => {
    const { fetchImpl, calls } = stubTileFetch();
    const app = makeTileApp(fetchImpl);
    const cookie = await credentials("reader-alice", "session-1", 1_000);
    const grant = await aliceGrant();
    const forged: Array<{ path: string; status: number }> = [
      { path: `${TILE_PATH_PREFIX}/4/8/11`, status: 404 },
      { path: `${TILE_PATH_PREFIX}/19/100/100`, status: 404 },
      { path: `${TILE_PATH_PREFIX}/12/4096/1469`, status: 404 },
      { path: `${TILE_PATH_PREFIX}/12/2074/1409`, status: 404 },
      { path: `${TILE_PATH_PREFIX}/12/1204/1469.png`, status: 400 },
      { path: `${TILE_PATH_PREFIX}/12/1204`, status: 400 },
    ];
    for (const { path, status } of forged) {
      expect((await request(app, path, cookie, grant)).status, path).toBe(status);
    }
    expect(calls).toHaveLength(0);
  });

  it("ignores the incoming query and answers 405/401 upstream-free", async () => {
    const { fetchImpl, calls } = stubTileFetch();
    const app = makeTileApp(fetchImpl);
    const cookie = await credentials("reader-alice", "session-1", 1_000);
    const grant = await aliceGrant();

    // Valid tile with an attack query: served, query never relayed.
    const queried = await request(app, `${TILE}?url=http://169.254.169.254`, cookie, grant);
    expect(queried.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain("169.254.169.254");

    // Non-GET, anonymous and off-host requests never reach upstream.
    expect(
      (
        await app.request(`http://${HOST}${TILE}?grant=${grant}`, {
          method: "POST",
          headers: { host: HOST, cookie },
        })
      ).status,
    ).toBe(405);
    expect((await request(app, TILE)).status).toBe(401);
    const foreign = await app.request(`http://evil.example.test${TILE}?grant=${grant}`, {
      headers: { host: "evil.example.test", cookie },
    });
    expect(foreign.status).toBe(404);
    expect(calls).toHaveLength(1);
  });
});
