import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type OutgoingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Socket } from "node:net";
import { Readable, type Duplex } from "node:stream";
import {
  admitLive, LIVE_ASSERTION_HEADER, LIVE_HTTP_ASSERTION_SECONDS, LIVE_WS_ASSERTION_SECONDS, type LiveAdmission,
  type LiveEdgePorts,
} from "@radar/artifacts-host";
import { parseContentHost } from "./content-host.js";

/**
 * Live edge forward on the immo content host (A-LIVE §8.2, W9 contract and
 * its CORRECTIF, tmp/conductor/concertation-git-artifact/sentropic-live-edge-contract-2026-11-07.md).
 *
 * On a stable artifact host `<artifactId>.<pages domain>`, the principal is
 * the release reader verified by the SAME code path as the release
 * (content-serve.ts `authorized`: sealed host, issuer, audience, tier,
 * session revocation). It is served LIVE only after the §8.2 admission
 * (admitLive: consent, code rights, owner or invitation, live authorization
 * record, readiness, controller grant at the current revision); otherwise
 * the release is served. A live request is forwarded to artifact-content:
 * - HTTP: GET/HEAD only, path and query unchanged, Host = the browser host
 *   (no port, node:http keeps it verbatim), Origin passed through, request
 *   and response headers by allowlist (cookies, Authorization, service-worker
 *   and forwarding headers never leave), a fresh assertion per request
 *   (exp = iat + 60 s);
 * - websocket (HMR): `GET /_live/<sessionId>/hmr[?token=]`, Origin required
 *   and equal to the pages origin, assertion exp = iat + 3600 s (capped at the
 *   invitation expiry). Sockets are capped per principal and per session,
 *   closed at exp, on revocation (socket registry) and when the shared
 *   recheck (one admission per artifact and principal per tick) refuses.
 * Every non-2xx answer (non-101 for a websocket), timeout or connection
 * failure shows « live indisponible »; an edge 404 also drops the cached grant.
 * Socket errors are handled from the first line of the upgrade handler (Node
 * removes its own handler on upgrade): a browser reset never escapes.
 */

export interface LiveEdgeForwardDeps {
  readonly contentBase: string;
  readonly ports: LiveEdgePorts;
  /** Release-reader verification of this request for this artifact host; the principal or null. */
  readonly principal: (request: Request, artifactId: string) => Promise<string | null>;
  readonly now?: () => number;
  /** Shared websocket recheck period (default 2 s; the grant itself is cached 30 s). */
  readonly recheckMs?: number;
  readonly timeoutMs?: number;
  readonly maxSocketsPerPrincipal?: number;
  readonly maxSocketsPerSession?: number;
}

/** Request headers sent upstream; nothing else leaves immo. */
const HTTP_FORWARDED = ["accept", "accept-language", "origin", "user-agent"] as const;
/** Response headers returned to the browser; nothing else (set-cookie, location, clear-site-data, HSTS, hop-by-hop). */
const RESPONSE_ALLOWED = new Set(["content-type", "content-length", "cache-control", "etag", "last-modified",
  "content-security-policy", "x-content-type-options", "referrer-policy", "cross-origin-opener-policy",
  "cross-origin-embedder-policy", "cross-origin-resource-policy", "permissions-policy", "x-frame-options", "vary"]);
/** Host-served subtrees (every `__` first segment: reader, app, tile relay, design kit; and the API): never forwarded. */
const RESERVED_PATH = /^\/(?:__[^/]*|api)(?:\/|$)/;
const HMR_PATH = /^\/_live\/([A-Za-z0-9_-]{1,128})\/hmr$/;
const TOKEN = /^[A-Za-z0-9_-]{1,256}$/;
const WS_KEY = /^[A-Za-z0-9+/]{22}==$/;
export const LIVE_MAX_SOCKETS_PER_PRINCIPAL = 4;
export const LIVE_MAX_SOCKETS_PER_SESSION = 32;

const UNAVAILABLE_HTML = "<!doctype html><html lang=\"fr\"><head><meta charset=\"utf-8\"><title>Live indisponible</title></head>" +
  "<body><main><h1>Live indisponible</h1><p>La session live de cet artefact ne répond pas pour le moment.</p></main></body></html>";
const UNAVAILABLE_HEADERS = {
  "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'", "referrer-policy": "no-referrer",
} as const;

export const liveUnavailable = (reason: string) => new Response(UNAVAILABLE_HTML,
  { status: 503, headers: { ...UNAVAILABLE_HEADERS, "x-live-state": reason } });
const notFound = () => new Response(JSON.stringify({ error: "not_found" }),
  { status: 404, headers: { "content-type": "application/json", "cache-control": "private, no-store" } });

/** The Host the edge requires: lower case, no port, one UUID label under the pages domain. */
function liveHost(raw: string | undefined, contentBase: string) {
  const host = raw?.trim().toLowerCase();
  if (!host || host.includes(":") || host.endsWith(".")) return undefined;
  const parsed = parseContentHost(host, contentBase);
  return parsed.kind === "content" ? { host, artifactId: parsed.id } : undefined;
}

/**
 * The query relayed upstream: the raw search minus every `grant` parameter
 * (the immo reader grant is honored here, never relayed; content-serve
 * invariant). Other parameters keep their exact bytes (Vite flags like `?import`).
 */
export function relayedSearch(search: string): string {
  const parts = search.replace(/^\?/, "").split("&").filter((part) => {
    if (!part) return false;
    const name = part.split("=")[0]!.replace(/\+/g, " ");
    try { return decodeURIComponent(name) !== "grant"; } catch { return true; }
  });
  return parts.length ? `?${parts.join("&")}` : "";
}

/** Destroys a socket without ever throwing (a refusal path must be safe on a reset socket). */
const destroy = (socket: Duplex | undefined) => { try { socket?.destroy(); } catch { /* already gone */ } };

interface Watch { readonly claims: { sessionId: string; routeEpoch: number; generation: number; principalId: string };
  readonly request: Request; readonly host: string; close(): void }

export function createLiveEdgeForward(deps: LiveEdgeForwardDeps) {
  const now = deps.now ?? Date.now;
  const { ports } = deps;
  const { sockets } = ports;
  const config = ports.resolution.config;
  const timeoutMs = deps.timeoutMs ?? 10_000;
  const unavailableReason = "reason" in ports.resolution ? ports.resolution.reason : "unconfigured";
  const maxPrincipal = deps.maxSocketsPerPrincipal ?? LIVE_MAX_SOCKETS_PER_PRINCIPAL;
  const maxSession = deps.maxSocketsPerSession ?? LIVE_MAX_SOCKETS_PER_SESSION;

  async function admit(request: Request, host: string, artifactId: string, lifetimeSeconds: number): Promise<LiveAdmission> {
    if (!config) return { kind: "none" };
    const principalId = await deps.principal(request, artifactId);
    if (!principalId) return { kind: "none" };
    return admitLive(ports, { host, artifactId, principalId, kid: config.kid, nowMs: now(), lifetimeSeconds });
  }

  // Shared websocket recheck: one admission per (artifact, principal) per tick, whatever the number of sockets.
  const watches = new Map<string, Set<Watch>>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await Promise.all([...watches.entries()].map(async ([group, set]) => {
        const first = [...set][0];
        if (!first) { watches.delete(group); return; }
        const artifactId = JSON.parse(group)[0] as string;
        let next: LiveAdmission;
        try { next = await admit(first.request, first.host, artifactId, LIVE_WS_ASSERTION_SECONDS); } catch { next = { kind: "none" }; }
        for (const watch of [...set]) {
          if (next.kind !== "live" || next.claims.sessionId !== watch.claims.sessionId ||
            next.claims.routeEpoch !== watch.claims.routeEpoch || next.claims.generation !== watch.claims.generation ||
            next.claims.principalId !== watch.claims.principalId) watch.close();
        }
      }));
    } finally { ticking = false; }
  };
  const watch = (artifactId: string, entry: Watch) => {
    const group = JSON.stringify([artifactId, entry.claims.principalId]);
    const set = watches.get(group) ?? new Set<Watch>();
    watches.set(group, set);
    set.add(entry);
    if (!timer) { timer = setInterval(() => { void tick(); }, deps.recheckMs ?? 2000); timer.unref(); }
    return () => {
      set.delete(entry);
      if (set.size === 0) watches.delete(group);
      if (watches.size === 0 && timer) { clearInterval(timer); timer = undefined; }
    };
  };

  function upstream(path: string, method: string, headers: OutgoingHttpHeaders) {
    const target = config!.target;
    const send = target.protocol === "https:" ? httpsRequest : httpRequest;
    return send({ protocol: target.protocol, hostname: target.hostname, port: target.port || undefined, method, path, headers,
      timeout: timeoutMs, setHost: false });
  }

  /** HTTP forward; undefined keeps the normal release serving. */
  async function fetch(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url);
    if (RESERVED_PATH.test(url.pathname)) return undefined;
    const live = url.pathname.startsWith("/_live/");
    const target = liveHost(request.headers.get("host") ?? undefined, deps.contentBase);
    if (!target) return live ? notFound() : undefined;
    if (request.method !== "GET" && request.method !== "HEAD") return live ? notFound() : undefined;
    // Unavailable state (incomplete configuration): no controller call, the release is kept.
    if (!config) return live ? liveUnavailable(unavailableReason) : undefined;
    let admission: LiveAdmission;
    try {
      admission = await admit(request, target.host, target.artifactId, LIVE_HTTP_ASSERTION_SECONDS);
    } catch {
      return live ? liveUnavailable("gate_unavailable") : undefined;
    }
    if (admission.kind === "none") return live ? notFound() : undefined;
    if (admission.kind === "release") return live ? liveUnavailable(admission.reason) : undefined;
    const principalId = admission.claims.principalId;
    let assertion: string;
    try { assertion = ports.signAssertion(admission.claims); } catch { return liveUnavailable("signer_unavailable"); }
    const headers: OutgoingHttpHeaders = { host: target.host, [LIVE_ASSERTION_HEADER]: assertion };
    for (const name of HTTP_FORWARDED) {
      const value = request.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    return await new Promise<Response>((resolve) => {
      let settled = false;
      const done = (response: Response) => { if (!settled) { settled = true; resolve(response); } };
      const outgoing = upstream(url.pathname + relayedSearch(url.search), request.method, headers);
      outgoing.once("timeout", () => { outgoing.destroy(); done(liveUnavailable("upstream_timeout")); });
      outgoing.on("error", () => done(liveUnavailable("upstream_unreachable")));
      outgoing.once("response", (incoming) => {
        incoming.on("error", () => undefined);
        const status = incoming.statusCode ?? 0;
        if (status < 200 || status > 299) {
          incoming.resume();
          if (status === 404) ports.grants.invalidate(target.artifactId, principalId);
          done(liveUnavailable(`upstream_${status}`));
          return;
        }
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value === undefined || !RESPONSE_ALLOWED.has(name)) continue;
          responseHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
        const body = request.method === "HEAD" || status === 204 ? null : Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
        if (!body) incoming.resume();
        done(new Response(body, { status, headers: responseHeaders }));
      });
      outgoing.end();
    });
  }

  const refuse = (socket: Duplex, status: 404 | 503, reason = "") => {
    if (socket.destroyed || !socket.writable) { destroy(socket); return; }
    const body = status === 503 ? UNAVAILABLE_HTML : "";
    try {
      socket.end(`HTTP/1.1 ${status === 404 ? "404 Not Found" : "503 Service Unavailable"}\r\n` +
        `Cache-Control: private, no-store\r\nConnection: close\r\n${reason ? `X-Live-State: ${reason}\r\n` : ""}` +
        `Content-Type: ${status === 503 ? "text/html; charset=utf-8" : "text/plain"}\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    } catch { destroy(socket); }
  };

  /** Websocket upgrade on a content host; false when the request is not on a content host (caller destroys). */
  async function upgrade(incoming: IncomingMessage, socket: Duplex, head: Buffer): Promise<boolean> {
    // FIRST, before any await: Node removed its own error handler on upgrade; a reset must never escape.
    socket.on("error", () => destroy(socket));
    const target = liveHost(incoming.headers.host, deps.contentBase);
    if (!target) return false;
    const url = new URL(incoming.url ?? "/", `https://${target.host}`);
    const match = HMR_PATH.exec(url.pathname);
    const query = [...url.searchParams.entries()];
    const key = incoming.headers["sec-websocket-key"];
    if (!match || incoming.method !== "GET" || incoming.headers.upgrade?.toLowerCase() !== "websocket" ||
      (incoming.url ?? "").startsWith("//") || typeof key !== "string" || !WS_KEY.test(key) ||
      incoming.headers["sec-websocket-version"] !== "13" || incoming.headers["sec-websocket-protocol"] !== "vite-hmr" ||
      !(query.length === 0 || (query.length === 1 && query[0]![0] === "token" && TOKEN.test(query[0]![1]))) ||
      incoming.headers.origin !== `https://${target.host}`) {
      refuse(socket, 404); return true;
    }
    const sessionId = match[1]!;
    if (!config) { refuse(socket, 503, unavailableReason); return true; }
    // The release-reader verification reads the same headers as an HTTP request on this host.
    const request = new Request(url, { headers: { host: target.host, ...(incoming.headers.cookie ? { cookie: incoming.headers.cookie } : {}) } });
    let admission: LiveAdmission;
    try {
      admission = await admit(request, target.host, target.artifactId, LIVE_WS_ASSERTION_SECONDS);
    } catch { refuse(socket, 503, "gate_unavailable"); return true; }
    if (socket.destroyed) return true;
    if (admission.kind === "none") { refuse(socket, 404); return true; }
    if (admission.kind === "release") { refuse(socket, 503, admission.reason); return true; }
    if (admission.claims.sessionId !== sessionId) { refuse(socket, 404); return true; }
    const claims = admission.claims;
    const liveSessionId = admission.liveSessionId;
    if (sockets.countPrincipal(target.artifactId, claims.principalId) >= maxPrincipal ||
      sockets.countSession(target.artifactId, sessionId) >= maxSession) { refuse(socket, 503, "socket_limit"); return true; }
    let assertion: string;
    try { assertion = ports.signAssertion(claims); } catch { refuse(socket, 503, "signer_unavailable"); return true; }
    // Allowlist: no cookie, Authorization or service-worker header reaches the edge.
    const headers: OutgoingHttpHeaders = { host: target.host, origin: incoming.headers.origin, connection: "Upgrade",
      upgrade: "websocket", "sec-websocket-key": key, "sec-websocket-version": "13", "sec-websocket-protocol": "vite-hmr",
      [LIVE_ASSERTION_HEADER]: assertion };
    const outgoing = upstream(url.pathname + url.search, "GET", headers);
    let tunnel: Duplex | undefined;
    let cleanup = () => {};
    const close = () => { cleanup(); destroy(socket); destroy(tunnel); outgoing.destroy(); };
    // Browser reset during the upstream handshake: abort the upstream request.
    socket.once("close", () => { if (!tunnel) outgoing.destroy(); });
    outgoing.once("timeout", () => { if (tunnel) return; outgoing.destroy(); refuse(socket, 503, "upstream_timeout"); });
    outgoing.on("error", () => { if (tunnel) close(); else refuse(socket, 503, "upstream_unreachable"); });
    outgoing.once("response", (response) => {
      response.on("error", () => undefined);
      response.resume();
      if (response.statusCode === 404) ports.grants.invalidate(target.artifactId, claims.principalId);
      refuse(socket, 503, `upstream_${response.statusCode ?? 0}`);
    });
    outgoing.once("upgrade", (response: IncomingMessage, peer: Duplex, upstreamHead: Buffer) => {
      tunnel = peer;
      peer.on("error", close);
      // The request timeout bounds the handshake only: an idle HMR socket stays open.
      (peer as Socket).setTimeout?.(0);
      if (response.statusCode !== 101 || socket.destroyed) { destroy(peer); refuse(socket, 503, "upstream_refused"); return; }
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${upgradeHeaders(response.headers)}\r\n`);
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) peer.write(head);
      // sessionId: the controller grant session (HMR path); liveSessionId: the package session (revocation by session).
      const unregister = sockets.register({ artifactId: target.artifactId, sessionId, principalId: claims.principalId, liveSessionId,
        ...(claims.role === "invitee" ? { invitationId: claims.invitationId } : {}) }, { close: () => close() });
      const expiry = setTimeout(close, Math.max(0, claims.exp * 1000 - now()));
      expiry.unref();
      const unwatch = watch(target.artifactId, { claims, request, host: target.host, close });
      cleanup = () => { cleanup = () => {}; clearTimeout(expiry); unwatch(); unregister(); };
      // Either side ending tears the tunnel down (no half-open socket is kept: the HTTP server allows half-open).
      socket.on("error", close); socket.once("close", close); socket.once("end", close);
      peer.once("close", close); peer.once("end", close);
      socket.pipe(peer); peer.pipe(socket);
    });
    outgoing.end();
    return true;
  }

  return { fetch, upgrade, sockets, watching: () => [...watches.values()].reduce((sum, set) => sum + set.size, 0) };
}
export type LiveEdgeForward = ReturnType<typeof createLiveEdgeForward>;

function upgradeHeaders(headers: IncomingHttpHeaders): string {
  const lines = ["Upgrade: websocket", "Connection: Upgrade"];
  const accept = headers["sec-websocket-accept"];
  if (typeof accept === "string") lines.push(`Sec-WebSocket-Accept: ${accept}`);
  const protocol = headers["sec-websocket-protocol"];
  if (typeof protocol === "string") lines.push(`Sec-WebSocket-Protocol: ${protocol}`);
  return lines.map((line) => `${line}\r\n`).join("");
}

/** Reader mount with the live forward first; the release reader answers whatever the forward leaves. */
export function withLiveEdge(reader: { readonly fetch: (req: Request) => Response | Promise<Response> },
  forward: Pick<LiveEdgeForward, "fetch">): { readonly fetch: (req: Request) => Promise<Response> } {
  return { fetch: async (req: Request) => (await forward.fetch(req)) ?? reader.fetch(req) };
}
