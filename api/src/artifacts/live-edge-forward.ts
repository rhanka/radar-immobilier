import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type OutgoingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import {
  admitLive, LIVE_ASSERTION_HEADER, LIVE_HTTP_ASSERTION_SECONDS, LIVE_WS_ASSERTION_SECONDS, type LiveAdmission,
  type LiveEdgePorts,
} from "@radar/artifacts-host";
import { parseContentHost } from "./content-host.js";

/**
 * Live edge forward on the immo content host (A-LIVE §8.2, W9 contract and
 * its CORRECTIF, tmp/conductor/concertation-git-artifact/sentropic-live-edge-contract-2026-11-07.md).
 *
 * On a stable artifact host `<artifactId>.<pages domain>`, a principal that
 * passes the §8.2 gate (binding owner or active invitee, current code rights,
 * live reader consent) is served LIVE only when the package live record is
 * ready for the current revision AND the controller grant answers 200 with
 * `grant.sourceRevision` = that revision (admitLive, artifacts-host
 * live-forward.ts); otherwise the release is served. A live request is
 * forwarded to artifact-content:
 * - HTTP: GET/HEAD only, path and query unchanged, Host = the browser host
 *   (no port, node:http keeps it verbatim), Origin passed through, cookies,
 *   Authorization and service-worker stripped (header allowlist), a fresh
 *   assertion per request (exp = iat + 60 s);
 * - websocket (HMR): `GET /_live/<sessionId>/hmr[?token=]`, Origin required
 *   and equal to the pages origin, assertion exp = iat + 3600 s (capped at the
 *   invitation expiry); the socket is closed at exp, on a refused recheck and
 *   on revocation through the socket registry.
 * Every non-2xx answer (non-101 for a websocket), timeout or connection
 * failure shows « live indisponible »; an edge 404 also drops the cached
 * grant (the next request asks the controller again). Readers outside the
 * gate, and gated principals while live is not admitted, keep the normal
 * release: the forward answers undefined and the reader mount serves as before.
 */

export interface LiveEdgeForwardDeps {
  readonly contentBase: string;
  readonly ports: LiveEdgePorts;
  /** Verified principal for this artifact host (the sealed reader session), or null. */
  readonly principal: (cookieHeader: string | undefined, artifactId: string) => string | null;
  readonly now?: () => number;
  /** Websocket admission recheck period (default 2 s; the grant itself is cached 30 s). */
  readonly recheckMs?: number;
  readonly timeoutMs?: number;
}

/** Request headers sent upstream: everything else (cookies, Authorization, service-worker, forwarding) stays here. */
const HTTP_FORWARDED = ["accept", "accept-language", "origin", "user-agent", "if-none-match", "if-modified-since"] as const;
const RESPONSE_DROPPED = new Set(["set-cookie", "connection", "keep-alive", "transfer-encoding", "upgrade",
  "proxy-authenticate", "proxy-connection", "trailer", "te"]);
const RESERVED_PATH = /^\/(?:__reader|__app|api)(?:\/|$)/;
const HMR_PATH = /^\/_live\/([A-Za-z0-9_-]{1,128})\/hmr$/;
const TOKEN = /^[A-Za-z0-9_-]{1,256}$/;
const WS_KEY = /^[A-Za-z0-9+/]{22}==$/;

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

export function createLiveEdgeForward(deps: LiveEdgeForwardDeps) {
  const now = deps.now ?? Date.now;
  const { ports } = deps;
  const { sockets } = ports;
  const config = ports.resolution.config;
  const timeoutMs = deps.timeoutMs ?? 10_000;
  const unavailableReason = "reason" in ports.resolution ? ports.resolution.reason : "unconfigured";

  async function admit(host: string, artifactId: string, cookie: string | undefined, lifetimeSeconds: number): Promise<LiveAdmission> {
    const principalId = deps.principal(cookie, artifactId);
    if (!principalId || !config) return { kind: "none" };
    return admitLive(ports, { host, artifactId, principalId, kid: config.kid, nowMs: now(), lifetimeSeconds });
  }

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
      admission = await admit(target.host, target.artifactId, request.headers.get("cookie") ?? undefined, LIVE_HTTP_ASSERTION_SECONDS);
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
      const outgoing = upstream(url.pathname + url.search, request.method, headers);
      outgoing.once("timeout", () => { outgoing.destroy(); done(liveUnavailable("upstream_timeout")); });
      outgoing.once("error", () => done(liveUnavailable("upstream_unreachable")));
      outgoing.once("response", (incoming) => {
        const status = incoming.statusCode ?? 0;
        if (status < 200 || status > 299) {
          incoming.resume();
          if (status === 404) ports.grants.invalidate(target.artifactId, principalId);
          done(liveUnavailable(`upstream_${status}`));
          return;
        }
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value === undefined || RESPONSE_DROPPED.has(name)) continue;
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
    if (socket.destroyed) return;
    const body = status === 503 ? UNAVAILABLE_HTML : "";
    socket.end(`HTTP/1.1 ${status === 404 ? "404 Not Found" : "503 Service Unavailable"}\r\n` +
      `Cache-Control: private, no-store\r\nConnection: close\r\n${reason ? `X-Live-State: ${reason}\r\n` : ""}` +
      `Content-Type: ${status === 503 ? "text/html; charset=utf-8" : "text/plain"}\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };

  /** Websocket upgrade on a content host; false when the request is not a live HMR upgrade (caller decides). */
  async function upgrade(incoming: IncomingMessage, socket: Duplex, head: Buffer): Promise<boolean> {
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
    let admission: LiveAdmission;
    try {
      admission = await admit(target.host, target.artifactId, incoming.headers.cookie, LIVE_WS_ASSERTION_SECONDS);
    } catch { refuse(socket, 503, "gate_unavailable"); return true; }
    if (admission.kind === "none") { refuse(socket, 404); return true; }
    if (admission.kind === "release") { refuse(socket, 503, admission.reason); return true; }
    if (admission.claims.sessionId !== sessionId) { refuse(socket, 404); return true; }
    const claims = admission.claims;
    let assertion: string;
    try { assertion = ports.signAssertion(claims); } catch { refuse(socket, 503, "signer_unavailable"); return true; }
    // Allowlist: no cookie, Authorization or service-worker header reaches the edge.
    const headers: OutgoingHttpHeaders = { host: target.host, origin: incoming.headers.origin, connection: "Upgrade",
      upgrade: "websocket", "sec-websocket-key": key, "sec-websocket-version": "13", "sec-websocket-protocol": "vite-hmr",
      [LIVE_ASSERTION_HEADER]: assertion };
    if (socket.destroyed) return true;
    const outgoing = upstream(url.pathname + url.search, "GET", headers);
    let tunnel: Duplex | undefined;
    let cleanup = () => {};
    const close = () => { cleanup(); socket.destroy(); tunnel?.destroy(); outgoing.destroy(); };
    outgoing.once("timeout", () => { if (tunnel) return; outgoing.destroy(); refuse(socket, 503, "upstream_timeout"); });
    outgoing.once("error", () => { if (tunnel) close(); else refuse(socket, 503, "upstream_unreachable"); });
    outgoing.once("response", (response) => {
      response.resume();
      if (response.statusCode === 404) ports.grants.invalidate(target.artifactId, claims.principalId);
      refuse(socket, 503, `upstream_${response.statusCode ?? 0}`);
    });
    outgoing.once("upgrade", (response: IncomingMessage, peer: Duplex, upstreamHead: Buffer) => {
      tunnel = peer;
      // The request timeout bounds the handshake only: an idle HMR socket stays open.
      (peer as Socket).setTimeout(0);
      if (response.statusCode !== 101 || socket.destroyed) { peer.destroy(); refuse(socket, 503, "upstream_refused"); return; }
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${upgradeHeaders(response.headers)}\r\n`);
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) peer.write(head);
      const unregister = sockets.register({ artifactId: target.artifactId, sessionId, principalId: claims.principalId,
        ...(claims.role === "invitee" ? { invitationId: claims.invitationId } : {}) }, { close: () => close() });
      const expiry = setTimeout(close, Math.max(0, claims.exp * 1000 - now()));
      let checking = false;
      const recheck = setInterval(() => {
        if (checking) return;
        checking = true;
        admit(target.host, target.artifactId, incoming.headers.cookie, LIVE_WS_ASSERTION_SECONDS)
          .then((next) => {
            if (next.kind !== "live" || next.claims.sessionId !== sessionId || next.claims.routeEpoch !== claims.routeEpoch ||
              next.claims.generation !== claims.generation || next.claims.principalId !== claims.principalId) close();
          }, close).finally(() => { checking = false; });
      }, deps.recheckMs ?? 2000);
      expiry.unref(); recheck.unref();
      cleanup = () => { cleanup = () => {}; clearTimeout(expiry); clearInterval(recheck); unregister(); };
      socket.once("close", close); socket.once("error", close);
      peer.once("close", close); peer.once("error", close);
      socket.pipe(peer); peer.pipe(socket);
    });
    outgoing.end();
    return true;
  }

  return { fetch, upgrade, sockets };
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
