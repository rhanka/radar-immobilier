/**
 * J1.1 OSM relay tests (B1): the same-origin OSM path serves tiles, maps
 * upstream failures, bounds zoom, caches with upstream TTL, throttles per
 * reader, and never leaks client identity upstream.
 */
import { describe, expect, it } from "vitest";
import { createReaderContentApp } from "./content-serve.js";
import { fingerprintReaderProfile } from "./reader-profile.js";
import { mintGrant } from "./preview-grant.js";
import {
  TILE_ATTRIBUTION_OSM,
  TILE_CLIENT_MAX_AGE_SECONDS,
  TILE_OSM_MAX_ZOOM,
  TILE_OSM_PATH_PREFIX,
  TILE_OSM_RATE_LIMIT_DEFAULT,
  createTileProxy,
  createTileProxyApp,
  parseOsmTilePath,
  TileProxy,
  type TileProxyMount,
  type TileProxyOptions,
  type TileRateLimit,
} from "./tile-proxy.js";
import {
  GRANT_SECRET,
  HOST,
  ISSUER,
  SESSION_SECRET,
  credentials,
  fixtureReaderDeps,
  request,
} from "./reader-test-fixture.js";

const PNG: Uint8Array<ArrayBuffer> = new Uint8Array(
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);

const OSM_TILE = `${TILE_OSM_PATH_PREFIX}/10/540/367`;

function response(status: number, headers: Record<string, string>, body?: Uint8Array<ArrayBuffer>): Response {
  return new Response(body ?? null, { status, headers });
}

interface StubControl {
  fetch: typeof fetch;
  calls: () => number;
  lastUrls: () => string[];
  lastHeaders: () => Array<Record<string, string>>;
}

function stubFetch(handler: (url: string) => Response | Promise<Response>): StubControl {
  let calls = 0;
  const urls: string[] = [];
  const headers: Array<Record<string, string>> = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    calls += 1;
    urls.push(String(url));
    headers.push(Object.fromEntries(new Headers(init?.headers as HeadersInit).entries()));
    return handler(String(url));
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls: () => calls, lastUrls: () => urls, lastHeaders: () => headers };
}

function osmApp(control: { fetch: typeof fetch }, options: {
  osmRateLimit?: TileRateLimit;
  rateLimitKey?: (c: { req: { header: (name: string) => string | undefined } }) => string | null;
  proxyOptions?: TileProxyOptions;
} = {}) {
  const proxy = createTileProxy({ fetchImpl: control.fetch, ...options.proxyOptions });
  const mount: TileProxyMount = {
    authorize: async () => true,
    isContentHost: () => true,
    proxy,
    rateLimitKey: options.rateLimitKey ?? (() => "reader-alice"),
    ...(options.osmRateLimit ? { osmRateLimit: options.osmRateLimit } : {}),
    ...(options.proxyOptions?.now ? { now: options.proxyOptions.now } : {}),
  };
  const app = createTileProxyApp(mount);
  return { app, proxy };
}

describe("OSM relay path validation", () => {
  it("should parse worldwide tiles with z bounded by the usage policy", () => {
    expect(parseOsmTilePath(`${TILE_OSM_PATH_PREFIX}/10/540/367`)).toEqual(
      { kind: "ok", layer: "tile", z: 10, x: 540, y: 367 });
    expect(parseOsmTilePath(`${TILE_OSM_PATH_PREFIX}/0/0/0`)).toEqual(
      { kind: "ok", layer: "tile", z: 0, x: 0, y: 0 });
    expect(parseOsmTilePath(`${TILE_OSM_PATH_PREFIX}/19/100/100`)).toEqual(
      { kind: "ok", layer: "tile", z: 19, x: 100, y: 100 });
    expect(TILE_OSM_MAX_ZOOM).toBe(19);
  });

  it("should refuse zoom above 19 and out-of-grid coordinates without upstream calls", async () => {
    const control = stubFetch(() => response(200, { "content-type": "image/png" }, PNG));
    const { app } = osmApp(control);
    for (const target of [
      `${TILE_OSM_PATH_PREFIX}/20/100/100`,
      `${TILE_OSM_PATH_PREFIX}/10/1024/367`,
      `${TILE_OSM_PATH_PREFIX}/10/540/1024`,
      `${TILE_OSM_PATH_PREFIX}/10/540/367.png`,
      `${TILE_OSM_PATH_PREFIX}/10/540`,
    ]) {
      const res = await app.request(target);
      expect([400, 404].includes(res.status), target).toBe(true);
    }
    expect(control.calls()).toBe(0);
  });
});

describe("OSM relay upstream", () => {
  it("should serve an OSM tile with strict headers on a cache miss", async () => {
    const control = stubFetch((url) => {
      expect(url).toBe("https://tile.openstreetmap.org/10/540/367.png");
      return response(200, { "content-type": "image/png" }, PNG);
    });
    const { app } = osmApp(control);
    const res = await app.request(OSM_TILE);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe(`private, max-age=${TILE_CLIENT_MAX_AGE_SECONDS}`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect(control.lastUrls()).toHaveLength(1);
  });

  it("should map an upstream error to a typed failure and a miss to 404", async () => {
    const down = stubFetch(() => response(500, { "content-type": "text/plain" }));
    expect((await osmApp(down).app.request(OSM_TILE)).status).toBe(502);
    expect(await (await osmApp(down).app.request(OSM_TILE)).json()).toEqual({ error: "tile_unavailable" });
    const missing = stubFetch(() => response(404, { "content-type": "text/plain" }));
    const missingRes = await osmApp(missing).app.request(OSM_TILE);
    expect(missingRes.status).toBe(404);
    expect(await missingRes.json()).toEqual({ error: "not_found" });
  });

  it("should never forward client identity upstream", async () => {
    const control = stubFetch(() => response(200, { "content-type": "image/png" }, PNG));
    const { app } = osmApp(control);
    await app.request(OSM_TILE, { headers: {
      cookie: "session=abc", authorization: "Bearer [REDACTED]", referer: "https://x.example/",
      "x-forwarded-for": "203.0.113.7", "x-real-ip": "203.0.113.7" } });
    const sent = control.lastHeaders()[0]!;
    expect(sent["user-agent"]).toContain("immo-tile-proxy/1");
    for (const leaked of ["cookie", "authorization", "referer", "x-forwarded-for", "forwarded", "x-real-ip"]) {
      expect(sent[leaked], leaked).toBeUndefined();
    }
  });

  it("should expose the OSM attribution kept visible in the page", () => {
    expect(TILE_ATTRIBUTION_OSM.text).toBe("© OpenStreetMap contributors");
    expect(TILE_ATTRIBUTION_OSM.licenseUrl).toBe("https://www.openstreetmap.org/copyright");
    expect(TILE_ATTRIBUTION_OSM.upstream).toBe("osm");
  });
});

describe("OSM relay cache", () => {
  it("should honor the upstream TTL and revalidate past freshness", async () => {
    let now = 1_000_000;
    const seen: Array<string | null> = [];
    const appControl = (() => {
      let n = 0;
      const urls: string[] = [];
      const fetchImpl = (async (url: unknown, init?: RequestInit) => {
        n += 1;
        urls.push(String(url));
        const headers = new Headers(init?.headers as HeadersInit);
        seen.push(headers.get("if-none-match"));
        if (n === 1) {
          return response(200, { "content-type": "image/png", etag: '"osm1"', "cache-control": "max-age=60" }, PNG);
        }
        return response(304, {});
      }) as unknown as typeof fetch;
      return { fetch: fetchImpl, calls: () => n, lastUrls: () => urls };
    })();
    const { app, proxy } = osmApp(appControl, { proxyOptions: { now: () => now } });
    expect((await app.request(OSM_TILE)).status).toBe(200);
    expect((await app.request(OSM_TILE)).status).toBe(200);
    expect(appControl.calls()).toBe(1);
    expect(proxy.metrics().hits).toBe(1);
    now += 61_000;
    const revalidated = await app.request(OSM_TILE);
    expect(revalidated.status).toBe(200);
    expect(new Uint8Array(await revalidated.arrayBuffer())).toEqual(PNG);
    expect(seen).toEqual([null, '"osm1"']);
    expect(appControl.calls()).toBe(2);
  });
});

describe("OSM per-reader rate limit", () => {
  it("should answer 429 with Retry-After past the per-reader budget, upstream-free", async () => {
    const control = stubFetch(() => response(200, { "content-type": "image/png" }, PNG));
    const { app } = osmApp(control, {
      osmRateLimit: { windowMs: 60_000, maxRequests: 2 },
      rateLimitKey: () => "reader-alice",
    });
    expect((await app.request(OSM_TILE)).status).toBe(200);
    expect((await app.request(OSM_TILE)).status).toBe(200);
    const limited = await app.request(OSM_TILE);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^[1-9][0-9]*$/);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    expect(control.calls()).toBe(1);
  });

  it("should throttle readers independently", async () => {
    const control = stubFetch(() => response(200, { "content-type": "image/png" }, PNG));
    let reader = "reader-alice";
    const { app } = osmApp(control, {
      osmRateLimit: { windowMs: 60_000, maxRequests: 1 },
      rateLimitKey: () => reader,
    });
    expect((await app.request(OSM_TILE)).status).toBe(200);
    expect((await app.request(OSM_TILE)).status).toBe(429);
    reader = "reader-bob";
    expect((await app.request(OSM_TILE)).status).toBe(200);
  });

  it("should default to the documented per-minute budget", () => {
    expect(TILE_OSM_RATE_LIMIT_DEFAULT).toEqual({ windowMs: 60_000, maxRequests: 300 });
  });
});

describe("OSM relay on the content host", () => {
  it("should serve the OSM relay to an authorized reader with the wired guard", async () => {
    const control = stubFetch(() => response(200, { "content-type": "image/png" }, PNG));
    const fixture = fixtureReaderDeps();
    const app = createReaderContentApp({
      ...fixture,
      contentBase: "pages.example.test",
      grantSecret: GRANT_SECRET,
      sessionSecret: SESSION_SECRET,
      issuer: ISSUER,
      tileProxy: new TileProxy({ fetchImpl: control.fetch }),
      now: () => 1_000,
    });
    const grant = await mintGrant(
      { ...ISSUER, host: HOST, artifactId: "123e4567-e89b-12d3-a456-426614174000",
        releaseId: "123e4567-e89b-12d3-a456-426614174001", readerSub: "reader-alice",
        sessionId: "session-1", profileName: "demo", policyRevision: "pol-001",
        profileFingerprint: fingerprintReaderProfile({ name: "demo", policyRevision: "pol-001",
          capabilities: ["geo.read", "signals.protected-read"] }) },
      GRANT_SECRET,
      1_000,
    );
    const cookie = await credentials("reader-alice", "session-1", 1_000);
    const res = await request(app, OSM_TILE, cookie, grant);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(control.lastUrls()[0]).toBe("https://tile.openstreetmap.org/10/540/367.png");
    expect((await request(app, OSM_TILE)).status).toBe(401);
  });
});
