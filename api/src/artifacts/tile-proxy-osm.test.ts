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
  TILE_BREAKER_DEFAULT_MS,
  TILE_BREAKER_MAX_MS,
  TILE_CLIENT_MAX_AGE_SECONDS,
  TILE_OSM_MAX_ZOOM,
  TILE_OSM_PATH_PREFIX,
  TILE_OSM_RATE_LIMIT_DEFAULT,
  createTileProxy,
  createTileProxyApp,
  parseOsmTilePath,
  parseRetryAfterMs,
  SlidingWindowLimiter,
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

describe("OSM throttle breaker (review m2)", () => {
  it("should map an upstream 429 to 503 with Retry-After and stop every reader until it elapses", async () => {
    let now = 1_000_000;
    let upstreamStatus = 429;
    const control = stubFetch(() => upstreamStatus === 200
      ? response(200, { "content-type": "image/png" }, PNG)
      : response(upstreamStatus, { "content-type": "text/plain", "retry-after": "120" }));
    let reader = "reader-alice";
    const { app, proxy } = osmApp(control, { proxyOptions: { now: () => now },
      osmRateLimit: { windowMs: 60_000, maxRequests: 100 }, rateLimitKey: () => reader });
    const first = await app.request(OSM_TILE);
    expect(first.status).toBe(503);
    expect(first.headers.get("retry-after")).toBe("120");
    expect(await first.json()).toEqual({ error: "upstream_throttled" });
    expect(proxy.breakerOpenUntil("osm", now)).toBe(now + 120_000);
    // Another reader, another tile: the breaker is global, no upstream call.
    reader = "reader-bob";
    now += 30_000;
    const blocked = await app.request(`${TILE_OSM_PATH_PREFIX}/10/541/367`);
    expect(blocked.status).toBe(503);
    expect(blocked.headers.get("retry-after")).toBe("90");
    expect(control.calls()).toBe(1);
    // Past Retry-After the breaker closes and the upstream is tried again.
    now += 91_000;
    upstreamStatus = 200;
    expect((await app.request(OSM_TILE)).status).toBe(200);
    expect(control.calls()).toBe(2);
    expect(proxy.breakerOpenUntil("osm", now)).toBeNull();
  });

  it.each([403, 418])("should open the breaker on %i with the default short pause", async (status) => {
    let now = 5_000_000;
    const control = stubFetch(() => response(status, { "content-type": "text/plain" }));
    const { app, proxy } = osmApp(control, { proxyOptions: { now: () => now } });
    const res = await app.request(OSM_TILE);
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe(String(TILE_BREAKER_DEFAULT_MS / 1000));
    expect(proxy.breakerOpenUntil("osm", now)).toBe(now + TILE_BREAKER_DEFAULT_MS);
    expect((await app.request(OSM_TILE)).status).toBe(503);
    expect(control.calls()).toBe(1);
    now += TILE_BREAKER_DEFAULT_MS;
    await app.request(OSM_TILE);
    expect(control.calls()).toBe(2);
  });

  it("should keep serving a stale cached tile while the breaker is open", async () => {
    let now = 1_000_000;
    let throttled = false;
    const control = stubFetch(() => throttled
      ? response(429, { "retry-after": "60" })
      : response(200, { "content-type": "image/png", "cache-control": "max-age=60" }, PNG));
    const { app } = osmApp(control, { proxyOptions: { now: () => now } });
    expect((await app.request(OSM_TILE)).status).toBe(200);
    now += 61_000;
    throttled = true;
    const stale = await app.request(OSM_TILE);
    expect(stale.status).toBe(200);
    expect(new Uint8Array(await stale.arrayBuffer())).toEqual(PNG);
    expect((await app.request(OSM_TILE)).status).toBe(200);
    expect(control.calls()).toBe(2);
  });

  it("should leave the default BDTQ/RNCan path without a breaker", async () => {
    const control = stubFetch(() => response(429, { "retry-after": "120" }));
    const proxy = createTileProxy({ fetchImpl: control.fetch });
    const res = await proxy.serve("tile", 12, 1200, 1400);
    expect(res.status).toBe(502);
    expect(proxy.breakerOpenUntil("quebec-bdtq20k")).toBeNull();
    expect(proxy.breakerOpenUntil("rncan-cbmt")).toBeNull();
  });

  it("should parse Retry-After seconds and HTTP-dates within the short bounds", () => {
    const now = Date.parse("2026-11-05T12:00:00Z");
    expect(parseRetryAfterMs("30", now)).toBe(30_000);
    expect(parseRetryAfterMs(null, now)).toBe(TILE_BREAKER_DEFAULT_MS);
    expect(parseRetryAfterMs("soon", now)).toBe(TILE_BREAKER_DEFAULT_MS);
    expect(parseRetryAfterMs("0", now)).toBe(1_000);
    expect(parseRetryAfterMs("Thu, 05 Nov 2026 12:02:00 GMT", now)).toBe(120_000);
    expect(parseRetryAfterMs("999999", now)).toBe(TILE_BREAKER_MAX_MS);
  });
});

describe("OSM limiter memory (review m3)", () => {
  it("should purge readers whose window is empty", () => {
    const limiter = new SlidingWindowLimiter({ windowMs: 60_000, maxRequests: 5 });
    for (let i = 0; i < 50; i += 1) expect(limiter.check(`reader-${i}`, 1_000)).toBeNull();
    expect(limiter.size).toBe(50);
    expect(limiter.check("reader-late", 1_000 + 60_001)).toBeNull();
    expect(limiter.size).toBe(1);
  });

  it("should cap tracked readers by evicting the least recently seen", () => {
    const limiter = new SlidingWindowLimiter({ windowMs: 60_000, maxRequests: 1 }, 3);
    expect(limiter.check("a", 1)).toBeNull();
    expect(limiter.check("b", 2)).toBeNull();
    expect(limiter.check("c", 3)).toBeNull();
    expect(limiter.check("a", 4)).toBe(60);
    expect(limiter.check("d", 5)).toBeNull();
    expect(limiter.size).toBe(3);
    // b was the least recently seen: evicted, so its budget starts fresh.
    expect(limiter.check("b", 6)).toBeNull();
    expect(limiter.check("a", 7)).toBe(60);
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
