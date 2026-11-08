import { createHash } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  createLiveGrantClient, createLiveSocketRegistry, createMemoryLiveAuthorizationStore, livePodName, LIVE_ASSERTION_HEADER,
  type LiveEdgePorts, type LiveGrant,
  type LiveReaderRole,
} from "@radar/artifacts-host";
import { signLiveAssertion, verifyLiveAssertion } from "@sentropic/artifacts/live-host";
import { createLiveEdgeForward, withLiveEdge } from "./live-edge-forward.js";

const SCOPE = "radar-immobilier-preprod";
const ARTIFACT = "11111111-1111-4111-8111-111111111111";
const DOMAIN = "pages.preprod.immo.sent-tech.ca";
const HOST = `${ARTIFACT}.${DOMAIN}`;
const ORIGIN = `https://${HOST}`;
const KID = "immo-preprod-live-1";
const KEY = new Uint8Array(32).fill(5);
const SESSION = "sess-1";
const WS_KEY = "dGhlIHNhbXBsZSBub25jZQ==";
const INVITE_EXP = Date.now() + 3_600_000;

/** Release-reader verification stand-in: the (fake) sealed reader cookie `reader=<principal>` on this artifact host. */
let principalDelayMs = 0;
const principal = async (request: Request, artifactId: string) => {
  if (principalDelayMs) await new Promise((resolve) => setTimeout(resolve, principalDelayMs));
  if (!request.headers.get("host")?.startsWith(artifactId)) return null;
  return /reader=([a-z]+)/.exec(request.headers.get("cookie") ?? "")?.[1] ?? null;
};

let edge: Server;
let edgeUrl: URL;
let edgeStatus: number;
let seen: Array<{ method: string | undefined; url: string | undefined; headers: IncomingHttpHeaders }>;
let upgrades: Duplex[];
let clients: Socket[] = [];
const closeEdge = () => new Promise<void>((resolve) => { edge.closeAllConnections(); edge.close(() => resolve()); });
let readiness: { revision: string; ready: boolean; liveSessionId: string };
let grantRevision: string;
let grantFetch: Mock<(url: URL, init: RequestInit) => Promise<Response>>;
let roles: Record<string, LiveReaderRole | null>;
let consent: boolean;

const grantFor = (body: { actor: { principalId: string; invitation?: { id: string; epoch: number; expiresAt: number } } }): LiveGrant => ({ storageScopeId: SCOPE, artifactId: ARTIFACT, sessionId: SESSION, generation: 1,
  routeEpoch: 2, podUid: "pod-uid-1", podName: livePodName(SCOPE, ARTIFACT), sourceRevision: grantRevision,
  principalId: body.actor.principalId, role: body.actor.invitation ? "invitee" : "binding_owner",
  invitationId: body.actor.invitation?.id ?? "", invitationEpoch: body.actor.invitation?.epoch ?? 0,
  invitationExp: body.actor.invitation ? Math.floor(body.actor.invitation.expiresAt / 1000) : 0 });

let authorizations: ReturnType<typeof createMemoryLiveAuthorizationStore>;
function ports(config = true): LiveEdgePorts {
  const grants = createLiveGrantClient({ baseUrl: "https://builder.test/api/v1/artifacts/builder",
    identity: { authorization: async () => "Bearer t" }, fetch: grantFetch as never });
  return {
    sessionState: { current: async () => ({ epoch: 1, expiresAt: INVITE_EXP }) },
    authorizations,
    invitations: {} as never,
    storageScopeId: SCOPE,
    resolution: config ? { enabled: true, config: { kid: KID, key: KEY, target: edgeUrl } } : { enabled: true, reason: "live_edge_url_missing" },
    gate: async (_scope, _artifact, principalId) => roles[principalId] ?? null,
    consent: async () => consent,
    readiness: { current: async () => readiness },
    grants,
    signAssertion: (claims) => signLiveAssertion(claims, KEY),
    sockets: createLiveSocketRegistry(),
    revocation: { invitation: async () => ({ closed: 0 }), session: async () => ({ closed: 0 }) },
  };
}

const verify = (token: string | string[] | undefined) =>
  verifyLiveAssertion(String(token), { key: (kid) => kid === KID ? KEY : undefined, now: () => Date.now() });

beforeEach(async () => {
  seen = []; upgrades = []; edgeStatus = 200; consent = true;
  readiness = { revision: "rev-7", ready: true, liveSessionId: SESSION };
  grantRevision = "rev-7";
  principalDelayMs = 0;
  authorizations = createMemoryLiveAuthorizationStore();
  // carol accepted her invitation (the owner's record is created on its first admitted open).
  await authorizations.ensure({ storageScopeId: SCOPE, artifactId: ARTIFACT, sessionId: SESSION, bindingGeneration: 1,
    principalId: "carol", role: "invitee", invitationId: "inv-1", expiresAt: new Date(INVITE_EXP).toISOString() });
  roles = {
    alice: { role: "binding_owner", principalId: "alice", bindingGeneration: 1 },
    carol: { role: "invitee", principalId: "carol", bindingGeneration: 1, invitationId: "inv-1", epoch: 1,
      expiresAt: new Date(INVITE_EXP).toISOString(), liveSessionId: SESSION },
  };
  grantFetch = vi.fn(async (_url: URL, init: RequestInit) =>
    new Response(JSON.stringify({ grant: grantFor(JSON.parse(String(init.body))) }), { status: 200 }));
  edge = createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    res.writeHead(edgeStatus, { "content-type": "text/javascript", "set-cookie": "edge=1", "cache-control": "no-store",
      "clear-site-data": "\"*\"", location: "https://evil.test/", "strict-transport-security": "max-age=1",
      "content-security-policy": "default-src 'self'" });
    res.end(req.method === "HEAD" ? undefined : "export const live = true;");
  });
  edge.on("upgrade", (req, socket: Duplex) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    upgrades.push(socket);
    const accept = createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n` +
      "Sec-WebSocket-Protocol: vite-hmr\r\n\r\n");
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve) => edge.listen(0, "127.0.0.1", resolve));
  edgeUrl = new URL(`http://127.0.0.1:${(edge.address() as AddressInfo).port}`);
});
afterEach(async () => {
  for (const socket of [...upgrades, ...clients]) socket.destroy();
  clients = [];
  await closeEdge();
});

const browser = (path: string, headers: Record<string, string> = {}, method = "GET") =>
  new Request(`https://${HOST}${path}`, { method, headers: { host: HOST, ...headers } });

describe("live edge forward: HTTP", () => {
  it("forwards GET with the exact Host, path and query, Origin as is, and no browser credentials", async () => {
    const forward = createLiveEdgeForward({ contentBase: DOMAIN, ports: ports(), principal });
    const response = await forward.fetch(browser("/src/main.ts?t=123&import", { cookie: "reader=alice; other=1",
      authorization: "Bearer browser", "service-worker": "script", origin: ORIGIN, accept: "*/*", "x-forwarded-for": "1.2.3.4" }));
    expect(response?.status).toBe(200);
    expect(await response!.text()).toBe("export const live = true;");
    // Response headers by allowlist.
    for (const name of ["set-cookie", "clear-site-data", "location", "strict-transport-security"]) {
      expect(response!.headers.get(name)).toBeNull();
    }
    expect(response!.headers.get("content-security-policy")).toBe("default-src 'self'");
    expect(response!.headers.get("cache-control")).toBe("no-store");
    const [request] = seen;
    expect(request).toMatchObject({ method: "GET", url: "/src/main.ts?t=123&import" });
    expect(request!.headers.host).toBe(HOST);
    expect(request!.headers.origin).toBe(ORIGIN);
    for (const name of ["cookie", "authorization", "service-worker", "x-forwarded-for"]) expect(request!.headers[name]).toBeUndefined();
    const claims = verify(request!.headers[LIVE_ASSERTION_HEADER]);
    expect(claims).toMatchObject({ v: 1, kid: KID, host: HOST, role: "binding_owner", principalId: "alice", sourceRevision: "rev-7",
      podUid: "pod-uid-1", sessionId: SESSION });
    expect(claims!.exp - claims!.iat).toBe(60);
    // The controller grant was asked once with the S2S bearer.
    expect(grantFetch).toHaveBeenCalledTimes(1);
  });

  it("forwards HEAD and an invitee, and asserts the invitee role", async () => {
    const forward = createLiveEdgeForward({ contentBase: DOMAIN, ports: ports(), principal });
    const response = await forward.fetch(browser("/index.html", { cookie: "reader=carol" }, "HEAD"));
    expect(response?.status).toBe(200);
    expect(seen[0]!.method).toBe("HEAD");
    expect(verify(seen[0]!.headers[LIVE_ASSERTION_HEADER])).toMatchObject({ role: "invitee", invitationId: "inv-1", invitationEpoch: 1 });
  });

  it("serves the release (undefined) outside the gate, without consent, while not ready, and on a grant mismatch", async () => {
    const release = (p = ports()) => createLiveEdgeForward({ contentBase: DOMAIN, ports: p, principal });
    expect(await release().fetch(browser("/", { cookie: "reader=mallory" }))).toBeUndefined();
    expect(await release().fetch(browser("/"))).toBeUndefined();
    consent = false;
    expect(await release().fetch(browser("/", { cookie: "reader=alice" }))).toBeUndefined();
    consent = true;
    readiness = { revision: "rev-7", ready: false, liveSessionId: SESSION };
    expect(await release().fetch(browser("/", { cookie: "reader=alice" }))).toBeUndefined();
    readiness = { revision: "rev-8", ready: true, liveSessionId: SESSION };
    expect(await release().fetch(browser("/", { cookie: "reader=alice" }))).toBeUndefined();
    grantFetch.mockImplementation(async () => new Response(JSON.stringify({ error: "invalid_phase" }), { status: 409 }));
    readiness = { revision: "rev-7", ready: true, liveSessionId: SESSION };
    expect(await release().fetch(browser("/", { cookie: "reader=alice" }))).toBeUndefined();
    expect(seen).toHaveLength(0);
    // The reader mount answers what the forward leaves.
    const reader = { fetch: vi.fn(async () => new Response("release")) };
    expect(await (await withLiveEdge(reader, release()).fetch(browser("/", { cookie: "reader=alice" }))).text()).toBe("release");
  });

  it("never forwards other methods, reserved paths or a host with a port", async () => {
    const forward = createLiveEdgeForward({ contentBase: DOMAIN, ports: ports(), principal });
    expect(await forward.fetch(browser("/", { cookie: "reader=alice" }, "POST"))).toBeUndefined();
    expect(await forward.fetch(browser("/__reader/open", { cookie: "reader=alice" }))).toBeUndefined();
    const ported = new Request(`https://${HOST}/`, { headers: { host: `${HOST}:443`, cookie: "reader=alice" } });
    expect(await forward.fetch(ported)).toBeUndefined();
    expect(seen).toHaveLength(0);
  });

  it("shows « live indisponible » on a non-2xx edge answer, drops the grant on a 404, and on a dead edge", async () => {
    const p = ports();
    const forward = createLiveEdgeForward({ contentBase: DOMAIN, ports: p, principal });
    edgeStatus = 502;
    const bad = await forward.fetch(browser("/", { cookie: "reader=alice" }));
    expect(bad?.status).toBe(503);
    expect(bad!.headers.get("x-live-state")).toBe("upstream_502");
    expect(await bad!.text()).toContain("Live indisponible");
    edgeStatus = 404;
    expect((await forward.fetch(browser("/", { cookie: "reader=alice" })))?.status).toBe(503);
    await forward.fetch(browser("/", { cookie: "reader=alice" }));
    // Cached once, dropped by the 404, asked again.
    expect(grantFetch).toHaveBeenCalledTimes(2);
    await closeEdge();
    const dead = await forward.fetch(browser("/", { cookie: "reader=alice" }));
    expect(dead?.status).toBe(503);
    expect(dead!.headers.get("x-live-state")).toBe("upstream_unreachable");
  });

  it("keeps the release in the unavailable state (incomplete configuration)", async () => {
    const forward = createLiveEdgeForward({ contentBase: DOMAIN, ports: ports(false), principal });
    expect(await forward.fetch(browser("/", { cookie: "reader=alice" }))).toBeUndefined();
    expect((await forward.fetch(browser("/_live/sess-1/hmr", { cookie: "reader=alice" })))?.status).toBe(503);
    expect(grantFetch).not.toHaveBeenCalled();
  });
});

/** Raw browser websocket handshake through a local server running the forward's upgrade handler. */
async function withUpgradeServer(p: LiveEdgePorts, run: (port: number) => Promise<void>) {
  const forward = createLiveEdgeForward({ contentBase: DOMAIN, ports: p, principal, recheckMs: 50 });
  const server = createServer((_req, res) => res.writeHead(404).end());
  server.on("upgrade", (incoming, socket, head) => {
    forward.upgrade(incoming, socket, head).then((handled) => { if (!handled) socket.destroy(); }, () => socket.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await run((server.address() as AddressInfo).port); } finally {
    for (const socket of clients) socket.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function handshake(port: number, path: string, headers: Record<string, string>) {
  const socket = connect(port, "127.0.0.1");
  socket.on("error", () => {});
  clients.push(socket);
  const lines = [`GET ${path} HTTP/1.1`, ...Object.entries({ host: HOST, upgrade: "websocket", connection: "Upgrade",
    "sec-websocket-key": WS_KEY, "sec-websocket-version": "13", "sec-websocket-protocol": "vite-hmr", origin: ORIGIN,
    cookie: "reader=alice", ...headers }).filter(([, value]) => value !== "").map(([name, value]) => `${name}: ${value}`)];
  socket.write(`${lines.join("\r\n")}\r\n\r\n`);
  let data = "";
  const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
  const first = new Promise<string>((resolve) => socket.on("data", (chunk) => { data += chunk.toString(); if (data.includes("\r\n\r\n")) resolve(data); }));
  return { socket, first, closed };
}

describe("live edge forward: websocket HMR", () => {
  it("forwards the upgrade with the exact Host, Origin, vite-hmr and a 3600 s assertion, and closes on revocation", async () => {
    const p = ports();
    await withUpgradeServer(p, async (port) => {
      const client = handshake(port, `/_live/${SESSION}/hmr?token=abc_DEF-1`, { cookie: "reader=carol" });
      expect(await client.first).toMatch(/^HTTP\/1\.1 101 /);
      const [upstream] = seen;
      expect(upstream).toMatchObject({ method: "GET", url: `/_live/${SESSION}/hmr?token=abc_DEF-1` });
      expect(upstream!.headers).toMatchObject({ host: HOST, origin: ORIGIN, "sec-websocket-protocol": "vite-hmr",
        "sec-websocket-key": WS_KEY, upgrade: "websocket" });
      expect(upstream!.headers.cookie).toBeUndefined();
      const claims = verify(upstream!.headers[LIVE_ASSERTION_HEADER]);
      expect(claims).toMatchObject({ role: "invitee", invitationId: "inv-1" });
      expect(claims!.exp).toBe(Math.min(claims!.iat + 3600, claims!.invitationExp));
      expect(p.sockets.size()).toBe(1);
      // Revocation through the shared registry closes the proxied socket immediately.
      expect(p.sockets.closeInvitation(ARTIFACT, "inv-1")).toBe(1);
      await client.closed;
      expect(p.sockets.size()).toBe(0);
    });
  });

  it("closes an open socket when the recheck no longer admits the principal (revoked in the store)", async () => {
    const p = ports();
    await withUpgradeServer(p, async (port) => {
      const client = handshake(port, `/_live/${SESSION}/hmr`, { cookie: "reader=carol" });
      expect(await client.first).toMatch(/^HTTP\/1\.1 101 /);
      roles.carol = null;
      await client.closed;
      expect(p.sockets.size()).toBe(0);
    });
  });

  it("refuses a malformed upgrade without reaching the edge", async () => {
    await withUpgradeServer(ports(), async (port) => {
      for (const [path, headers] of [
        [`/_live/${SESSION}/hmr?token=a&x=1`, {}],
        [`/_live/${SESSION}/hmr?other=1`, {}],
        [`/_live/${SESSION}/hmr`, { origin: "" }],
        [`/_live/${SESSION}/hmr`, { origin: "https://evil.test" }],
        [`/_live/${SESSION}/hmr`, { "sec-websocket-protocol": "" }],
        [`/_live/${SESSION}/hmr`, { "sec-websocket-protocol": "chat" }],
        [`/_live/other-session/hmr`, {}],
        [`/_live/${SESSION}/hmr`, { cookie: "reader=mallory" }],
      ] as const) {
        const client = handshake(port, path, headers);
        expect(await client.first).toMatch(/^HTTP\/1\.1 404 /);
        await client.closed;
      }
      expect(seen).toHaveLength(0);
    });
  });

  it("answers « live indisponible » when live is not admitted or the edge refuses", async () => {
    readiness = { revision: "rev-7", ready: false, liveSessionId: SESSION };
    await withUpgradeServer(ports(), async (port) => {
      const client = handshake(port, `/_live/${SESSION}/hmr`, {});
      expect(await client.first).toMatch(/^HTTP\/1\.1 503 [\s\S]*X-Live-State: not_ready/);
    });
    readiness = { revision: "rev-7", ready: true, liveSessionId: SESSION };
    edge.removeAllListeners("upgrade");
    edge.on("upgrade", (_req, socket: Duplex) => { socket.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n"); });
    await withUpgradeServer(ports(), async (port) => {
      const client = handshake(port, `/_live/${SESSION}/hmr`, {});
      expect(await client.first).toMatch(/^HTTP\/1\.1 503 [\s\S]*X-Live-State: upstream_404/);
    });
  });

  it("survives a browser reset while the admission is pending (B1 regression: no uncaught ECONNRESET)", async () => {
    principalDelayMs = 200;
    await withUpgradeServer(ports(), async (port) => {
      for (const path of [`/_live/${SESSION}/hmr`, `/_live/${SESSION}/hmr?bad=1`]) {
        const client = handshake(port, path, {});
        await new Promise((resolve) => setTimeout(resolve, 20));
        client.socket.resetAndDestroy();
        await client.closed;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
      // The server is still serving upgrades afterwards.
      principalDelayMs = 0;
      const after = handshake(port, `/_live/${SESSION}/hmr`, {});
      expect(await after.first).toMatch(/^HTTP\/1\.1 101 /);
    });
  });

  it("survives a browser reset during the upstream handshake", async () => {
    edge.removeAllListeners("upgrade");
    edge.on("upgrade", (_req, socket: Duplex) => { upgrades.push(socket); socket.on("error", () => {}); /* never answers */ });
    await withUpgradeServer(ports(), async (port) => {
      const client = handshake(port, `/_live/${SESSION}/hmr`, {});
      await new Promise((resolve) => setTimeout(resolve, 100));
      client.socket.resetAndDestroy();
      await client.closed;
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  });

  it("caps the proxied sockets per principal and shares one recheck per principal", async () => {
    const p = ports();
    await withUpgradeServer(p, async (port) => {
      const open = [];
      for (let index = 0; index < 4; index += 1) {
        const client = handshake(port, `/_live/${SESSION}/hmr`, {});
        expect(await client.first).toMatch(/^HTTP\/1\.1 101 /);
        open.push(client);
      }
      const fifth = handshake(port, `/_live/${SESSION}/hmr`, {});
      expect(await fifth.first).toMatch(/^HTTP\/1\.1 503 [\s\S]*X-Live-State: socket_limit/);
      expect(p.sockets.countPrincipal(ARTIFACT, "alice")).toBe(4);
      // One shared admission per tick for the 4 sockets (grant cached; the gate is read once per tick, not per socket).
      const gate = vi.spyOn(p, "gate");
      await new Promise((resolve) => setTimeout(resolve, 130));
      const ticks = gate.mock.calls.length;
      expect(ticks).toBeGreaterThanOrEqual(1);
      expect(ticks).toBeLessThanOrEqual(3);
    });
  });
});
