import { describe, expect, it } from "vitest";
import {
  TILE_ATTRIBUTION_DEFAULT,
  TILE_ATTRIBUTION_FALLBACK,
  TILE_CACHE_MAX_BYTES,
  TILE_CACHE_MAX_ENTRIES,
  TILE_CLIENT_MAX_AGE_SECONDS,
  TILE_MAX_TILE_BYTES,
  TILE_PATH_PREFIX,
  TILE_UPSTREAMS,
  createTileProxy,
  createTileProxyApp,
  parseTilePath,
  type TileProxyOptions,
} from "./tile-proxy.js";

const TILE_PATH = `${TILE_PATH_PREFIX}/12/1204/1469`;
const LABELS_PATH = `${TILE_PATH_PREFIX}/labels/12/1204/1469`;

const PNG: Uint8Array<ArrayBuffer> = new Uint8Array(
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
const JPEG: Uint8Array<ArrayBuffer> = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]);

function response(status: number, headers: Record<string, string>, body?: Uint8Array<ArrayBuffer>): Response {
  return new Response(body ?? null, { status, headers });
}

interface StubControl {
  fetch: typeof fetch;
  calls: () => number;
  lastUrls: () => string[];
  handler: (url: string, init: RequestInit) => Response | Promise<Response>;
}

function stubFetch(handler: StubControl["handler"]): StubControl {
  let calls = 0;
  const urls: string[] = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    calls += 1;
    urls.push(String(url));
    return handler(String(url), init ?? {});
  }) as typeof fetch;
  return { fetch: fetchImpl, calls: () => calls, lastUrls: () => urls, handler };
}

function testApp(control: StubControl, options?: {
  authorized?: boolean;
  contentHost?: boolean;
  proxyOptions?: TileProxyOptions;
}) {
  const proxy = createTileProxy({ fetchImpl: control.fetch, ...options?.proxyOptions });
  const app = createTileProxyApp({
    authorize: async () => options?.authorized ?? true,
    isContentHost: () => options?.contentHost ?? true,
    proxy,
  });
  return { app, proxy };
}

describe("tile-proxy reserved path validation", () => {
  it("should parse the frozen public template", () => {
    expect(parseTilePath(`${TILE_PATH_PREFIX}/12/1204/1469`)).toEqual(
      { kind: "ok", layer: "tile", z: 12, x: 1204, y: 1469 });
    expect(parseTilePath(`${TILE_PATH_PREFIX}/labels/12/1204/1469`)).toEqual(
      { kind: "ok", layer: "labels", z: 12, x: 1204, y: 1469 });
  });

  it("should reject malformed shapes before any numeric check", () => {
    for (const target of [
      `${TILE_PATH_PREFIX}/12/1204/1469.png`,
      `${TILE_PATH_PREFIX}/12//1204/1469`,
      `${TILE_PATH_PREFIX}/12/1204`,
      `${TILE_PATH_PREFIX}/12/1204/1469/extra`,
      `${TILE_PATH_PREFIX}/12/../1204/1469`,
      `${TILE_PATH_PREFIX}/12/12%2e0/1469`,
      `${TILE_PATH_PREFIX}/12/1200\\1500`,
      `${TILE_PATH_PREFIX}/12/-1/1469`,
      `${TILE_PATH_PREFIX}/12/0x4b0/1469`,
    ]) {
      expect(parseTilePath(target).kind, target).toBe("malformed");
    }
  });

  it("should answer out-of-range for numeric misses inside Quebec checks", () => {
    for (const target of [
      `${TILE_PATH_PREFIX}/4/8/11`,
      `${TILE_PATH_PREFIX}/19/100/100`,
      `${TILE_PATH_PREFIX}/12/4096/1469`,
      `${TILE_PATH_PREFIX}/12/1204/4096`,
      `${TILE_PATH_PREFIX}/12/2074/1409`,
    ]) {
      expect(parseTilePath(target).kind, target).toBe("out-of-range");
    }
  });
});

describe("tile-proxy anti-SSRF gates", () => {
  it("should refuse forged paths with zero upstream calls", async () => {
    const control = stubFetch(() => response(200, { "content-type": "image/png" }, PNG));
    const { app } = testApp(control);
    const forged: Array<{ path: string; status: number }> = [
      { path: `${TILE_PATH_PREFIX}/4/8/11`, status: 404 },
      { path: `${TILE_PATH_PREFIX}/19/100/100`, status: 404 },
      { path: `${TILE_PATH_PREFIX}/12/4096/1469`, status: 404 },
      { path: `${TILE_PATH_PREFIX}/12/2074/1409`, status: 404 },
      { path: `${TILE_PATH_PREFIX}/12/1204/1469.png`, status: 400 },
      { path: `${TILE_PATH_PREFIX}/12//1204/1469`, status: 400 },
      { path: `${TILE_PATH_PREFIX}/12/1204/1469?url=http://169.254.169.254`, status: 200 },
      { path: `${TILE_PATH_PREFIX}/@evil.com/12/1500`, status: 400 },
    ];
    for (const { path, status } of forged) {
      const res = await app.request(path);
      expect(res.status, path).toBe(status);
    }
    // Only the query-carrying request is a real tile: exactly one upstream call.
    expect(control.calls()).toBe(1);
    expect(control.lastUrls()[0]).not.toContain("?");
    expect(control.lastUrls()[0]).not.toContain("169.254.169.254");
  });

  it("should refuse encoded traversal, backslash and dot segments without upstream calls", async () => {
    const control = stubFetch(() => response(200, { "content-type": "image/png" }, PNG));
    const { app } = testApp(control);
    for (const path of [
      `${TILE_PATH_PREFIX}/12/1200/15%2e00`,
      `${TILE_PATH_PREFIX}/12/1200/15%2F00`,
      `${TILE_PATH_PREFIX}/%5c12/1200/1469`,
      `${TILE_PATH_PREFIX}/12/1204/1469.json`,
      `${TILE_PATH_PREFIX}/14/4825/5860.svg`,
    ]) {
      const res = await app.request(path);
      expect([400, 404].includes(res.status), path).toBe(true);
    }
    expect(control.calls()).toBe(0);
  });

  it("should answer 405 to non-GET methods with zero upstream calls", async () => {
    const control = stubFetch(() => response(200, { "content-type": "image/png" }, PNG));
    const { app } = testApp(control);
    const res = await app.request(TILE_PATH, { method: "POST" });
    expect(res.status).toBe(405);
    expect(control.calls()).toBe(0);
  });

  it("should answer 401 without a session and 404 off the content host, both upstream-free", async () => {
    const control = stubFetch(() => response(200, { "content-type": "image/png" }, PNG));
    const closed = testApp(control, { authorized: false });
    expect((await closed.app.request(TILE_PATH)).status).toBe(401);
    const foreign = testApp(control, { contentHost: false });
    expect((await foreign.app.request(TILE_PATH)).status).toBe(404);
    expect(control.calls()).toBe(0);
  });
});

describe("tile-proxy upstream relay", () => {
  it("should relay Quebec bytes with strict headers on a cache miss", async () => {
    const control = stubFetch((url) => {
      expect(url).toContain(TILE_UPSTREAMS["quebec-bdtq20k"].host);
      return response(200, { "content-type": "image/jpeg" }, JPEG);
    });
    const { app } = testApp(control);
    const res = await app.request(TILE_PATH);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe(`private, max-age=${TILE_CLIENT_MAX_AGE_SECONDS}`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
  });

  it("should ignore the incoming query and never relay headers upstream", async () => {
    let seen: RequestInit | undefined;
    const control = stubFetch((_url, init) => {
      seen = init;
      return response(200, { "content-type": "image/png" }, PNG);
    });
    const { app } = testApp(control);
    const res = await app.request(`${TILE_PATH}?url=https://attacker.example&grant=stale`, {
      headers: { cookie: "session=abc", authorization: "Bearer stale", referer: "https://x.example/" },
    });
    expect(res.status).toBe(200);
    expect(control.lastUrls()[0]).not.toContain("?");
    const sent = new Headers((seen?.headers ?? {}) as HeadersInit);
    expect(sent.get("accept")).toBe("image/jpeg,image/png");
    expect(sent.get("user-agent")).toContain("immo-tile-proxy/1");
    expect(sent.has("cookie")).toBe(false);
    expect(sent.has("authorization")).toBe(false);
    expect(sent.has("referer")).toBe(false);
  });

  it("should never follow a redirect and answer 502 without caching", async () => {
    const control = stubFetch(() => response(302, { location: "http://radar-postgres:5432/" }));
    const { app, proxy } = testApp(control);
    const res = await app.request(TILE_PATH);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("radar-postgres");
    expect(proxy.metrics().upstreamBytes).toBe(0);
  });

  it("should reject a non-image payload and magic-byte mismatches with 502", async () => {
    const html = stubFetch(() => response(200, { "content-type": "text/html" }, PNG));
    expect((await testApp(html).app.request(TILE_PATH)).status).toBe(502);
    const mismatch = stubFetch(() => response(200, { "content-type": "image/png" },
      new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c])));
    expect((await testApp(mismatch).app.request(TILE_PATH)).status).toBe(502);
    expect(html.calls() + mismatch.calls()).toBeGreaterThan(0);
  });

  it("should reject oversized tiles with 502 and keep them out of the cache", async () => {
    const big = new Uint8Array(TILE_MAX_TILE_BYTES + 8);
    big[0] = 0x89;
    big[1] = 0x50;
    const control = stubFetch(() => response(200, { "content-type": "image/png" }, big));
    const { app, proxy } = testApp(control);
    expect((await app.request(TILE_PATH)).status).toBe(502);
    expect(proxy.metrics().upstreamBytes).toBe(0);
    expect(proxy.metrics().entries).toBe(0);
  });

  it("should fall back to RNCan when Quebec fails, then answer 502 when both fail", async () => {
    const control = stubFetch((url) =>
      url.includes("servicesmatriciels")
        ? response(500, { "content-type": "text/plain" })
        : response(200, { "content-type": "image/jpeg" }, JPEG));
    const { app } = testApp(control);
    const res = await app.request(TILE_PATH);
    expect(res.status).toBe(200);
    expect(control.calls()).toBe(2);
    expect(control.lastUrls()[1]).toContain(TILE_UPSTREAMS["rncan-cbmt"].host);

    const down = stubFetch(() => response(500, { "content-type": "text/plain" }));
    const downApp = testApp(down);
    expect((await downApp.app.request(TILE_PATH)).status).toBe(502);
    expect(down.calls()).toBe(2);
  });

  it("should answer 502 on upstream slowness past the timeout", async () => {
    const hanging = stubFetch((_url, init) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const { app } = testApp(hanging, { proxyOptions: { upstreamTimeoutMs: 50 } });
    expect((await app.request(TILE_PATH)).status).toBe(502);
    expect(hanging.calls()).toBe(2);
  });

  it("should serve labels from the fallback overlay and tiles from the default", async () => {
    const control = stubFetch((url) => {
      if (url.includes("CBMT_TXT_3857")) return response(200, { "content-type": "image/png" }, PNG);
      if (url.includes("maps-cartes")) return response(200, { "content-type": "image/jpeg" }, JPEG);
      return response(200, { "content-type": "image/jpeg" }, JPEG);
    });
    const { app } = testApp(control);
    const labels = await app.request(LABELS_PATH);
    expect(labels.status).toBe(200);
    expect(labels.headers.get("content-type")).toBe("image/png");
    expect(control.lastUrls()[0]).toContain("CBMT_TXT_3857");
    const tile = await app.request(TILE_PATH);
    expect(tile.status).toBe(200);
    expect(control.lastUrls()[1]).toContain("servicesmatriciels");
  });
});

describe("tile-proxy cache", () => {
  it("should fetch once for two reads of the same tile across origins", async () => {
    const control = stubFetch(() => response(200, {
      "content-type": "image/png", etag: '"v1"', "cache-control": "public, max-age=86400",
    }, PNG));
    const { app, proxy } = testApp(control);
    expect((await app.request(TILE_PATH)).status).toBe(200);
    expect((await app.request(TILE_PATH)).status).toBe(200);
    expect(control.calls()).toBe(1);
    expect(proxy.metrics().hits).toBe(1);
    expect(proxy.metrics().misses).toBe(1);
  });

  it("should coalesce concurrent requests into a single upstream call", async () => {
    let release!: (value: Response) => void;
    const gate = new Promise<Response>((resolve) => { release = resolve; });
    const control = stubFetch(() => gate);
    const { app } = testApp(control);
    const pending = Promise.all([app.request(TILE_PATH), app.request(TILE_PATH)]);
    release(response(200, { "content-type": "image/png" }, PNG));
    const [first, second] = await pending;
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(control.calls()).toBe(1);
  });

  it("should revalidate with If-None-Match after freshness and keep serving on 304", async () => {
    let now = 1_000_000;
    const seen: Array<string | null> = [];
    const control = stubFetch((_url, init) => {
      const headers = new Headers(init.headers as HeadersInit);
      seen.push(headers.get("if-none-match"));
      if (seen.length === 1) {
        return response(200, { "content-type": "image/png", etag: '"v1"', "cache-control": "max-age=1" }, PNG);
      }
      return response(304, {});
    });
    const { app } = testApp(control, { proxyOptions: { now: () => now } });
    expect((await app.request(TILE_PATH)).status).toBe(200);
    now += 2000;
    const second = await app.request(TILE_PATH);
    expect(second.status).toBe(200);
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(PNG);
    expect(seen).toEqual([null, '"v1"']);
    expect(control.calls()).toBe(2);
  });

  it("should evict least-recently-used tiles within the byte and entry bounds", async () => {
    const control = stubFetch(() => response(200, { "content-type": "image/png" }, PNG));
    const { app, proxy } = testApp(control, { proxyOptions: { maxEntries: 2, maxBytes: 64 } });
    const paths = [
      `${TILE_PATH_PREFIX}/12/1204/1469`,
      `${TILE_PATH_PREFIX}/12/1205/1469`,
      `${TILE_PATH_PREFIX}/12/1206/1469`,
    ];
    for (const path of paths) expect((await app.request(path)).status).toBe(200);
    const metrics = proxy.metrics();
    expect(metrics.entries).toBeLessThanOrEqual(2);
    expect(metrics.bytes).toBeLessThanOrEqual(64);
    expect(metrics.evictions).toBeGreaterThanOrEqual(1);
    expect((await app.request(paths[0] as string)).status).toBe(200);
    expect(control.calls()).toBe(4);
  });

  it("should hold missing tiles in the short negative cache, then retry", async () => {
    let now = 1_000_000;
    const control = stubFetch(() => response(404, { "content-type": "text/plain" }));
    const { app, proxy } = testApp(control, { proxyOptions: { now: () => now } });
    expect((await app.request(TILE_PATH)).status).toBe(404);
    expect((await app.request(TILE_PATH)).status).toBe(404);
    expect(control.calls()).toBe(2);
    expect(proxy.metrics().negativeHits).toBe(1);
    now += 6 * 60 * 1000;
    expect((await app.request(TILE_PATH)).status).toBe(404);
    expect(control.calls()).toBe(4);
  });

  it("should expose metrics without any reader-identifying field", async () => {
    const control = stubFetch(() => response(200, { "content-type": "image/png" }, PNG));
    const { proxy } = testApp(control);
    await proxy.serve("tile", 12, 1204, 1469);
    expect(Object.keys(proxy.metrics()).sort()).toEqual(
      ["bytes", "entries", "evictions", "hits", "misses", "negativeHits", "upstreamBytes", "upstreamCalls"]);
    expect(TILE_CACHE_MAX_BYTES).toBe(256 * 1024 * 1024);
    expect(TILE_CACHE_MAX_ENTRIES).toBe(20000);
  });
});

describe("tile-proxy attribution", () => {
  it("should expose both source strings for the I-4 map base", () => {
    expect(TILE_ATTRIBUTION_DEFAULT.text).toContain("Gouvernement du Québec");
    expect(TILE_ATTRIBUTION_DEFAULT.licenseUrl).toBe("https://www.donneesquebec.ca/licence/");
    expect(TILE_ATTRIBUTION_FALLBACK.text).toContain("Ressources naturelles Canada");
    expect(TILE_ATTRIBUTION_FALLBACK.licenseUrl).toContain("ouvert.canada.ca");
  });
});
