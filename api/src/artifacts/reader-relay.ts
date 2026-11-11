/**
 * Generic app-API relay for artifact pages (owner decision: RW, no
 * per-operation filtering). The artifact transport rewrites every app
 * `/api/*` call to `/__reader/app/api/*` on the SAME content host; this
 * handler authenticates the reader exactly like the named ops (sealed
 * session + grant + live authority), then dispatches the call IN-PROCESS
 * to the application with a short-lived app session minted for the
 * reader's own `sub` (`readerSub === session.sub`, reader-opening.ts).
 * The application's own authorisations are the only limit: the relay
 * checks no capability, no basket consent and no operation allowlist,
 * and passes application refusals through unchanged.
 *
 * Security invariants kept (not operation filtering):
 * - reader authentication + authority freshness, re-checked per call;
 * - writes require a same-origin proof (Origin host or Sec-Fetch-Site),
 *   so a foreign site cannot ride the reader session (CSRF);
 * - only `/api/*` paths are relayed; the target is the in-process app
 *   dispatch at a fixed origin — no caller-supplied host, no SSRF;
 * - page credentials never cross: Cookie/Authorization/x-preview-grant
 *   are dropped and replaced by the minted app session cookie alone;
 * - relayed responses never set cookies and are `private, no-store`.
 */
import { SESSION_COOKIE_NAME, signSession } from "../services/auth/session.js";

export const READER_RELAY_PREFIX = "/__reader/app";
export const RELAY_SESSION_TTL_SECONDS = 60;
export const RELAY_BODY_MAX_BYTES = 10 * 1024 * 1024;

export interface ReaderRelayDeps {
  /** In-process application dispatch (the composed app's `fetch`). */
  readonly dispatch: (request: Request) => Promise<Response> | Response;
  /** Fixed application origin the relayed request is addressed to. */
  readonly appOrigin: string;
  /** App session secret (`auth.sessionSecret`); empty keeps open mode. */
  readonly appSessionSecret: string;
  readonly now?: () => number;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const HOP_HEADERS = new Set(["connection", "keep-alive", "proxy-authenticate",
  "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host",
  "content-length", "cookie", "authorization", "x-preview-grant", "origin", "referer"]);

/** App path relayed by a request URL, or null when outside `/api/*`. */
export function relayAppPath(url: URL): string | null {
  if (url.pathname !== READER_RELAY_PREFIX && !url.pathname.startsWith(`${READER_RELAY_PREFIX}/`)) return null;
  const path = url.pathname.slice(READER_RELAY_PREFIX.length) || "/";
  if (path !== "/api" && !path.startsWith("/api/")) return null;
  if (path.includes("\\") || path.split("/").some((seg) => seg === ".." || seg === ".")) return null;
  try { if (decodeURIComponent(path).split("/").some((seg) => seg === "..")) return null; } catch { return null; }
  return path;
}

/** Same-origin proof for state-changing calls (browser fetch from the page). */
export function hasSameOriginProof(request: Request): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin";
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).host.toLowerCase() === (request.headers.get("host") ?? "").toLowerCase(); }
  catch { return false; }
}

function relayJson(status: number, error: string): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });
}

/**
 * Relay one reader-authenticated request to the app. `readerSub` comes
 * from the verified reader context — never from page input.
 */
export async function handleReaderRelay(input: {
  readonly request: Request; readonly readerSub: string; readonly relay: ReaderRelayDeps;
}): Promise<Response> {
  const { request, readerSub, relay } = input;
  const url = new URL(request.url);
  const path = relayAppPath(url);
  if (path === null) return relayJson(404, "not_found");
  if (!hasSameOriginProof(request)) return relayJson(403, "csrf_refused");
  const query = new URLSearchParams(url.search);
  query.delete("grant");
  const target = `${relay.appOrigin.replace(/\/$/, "")}${path}${query.toString() ? `?${query}` : ""}`;
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (!HOP_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  }
  if (relay.appSessionSecret) {
    const token = await signSession({ sub: readerSub }, {
      sessionSecret: relay.appSessionSecret, ttlSeconds: RELAY_SESSION_TTL_SECONDS,
      ...(relay.now ? { now: relay.now() } : {}),
    });
    headers.set("cookie", `${SESSION_COOKIE_NAME}=${token}`);
  }
  const method = request.method.toUpperCase();
  let body: ArrayBuffer | undefined;
  if (!SAFE_METHODS.has(method) && method !== "GET" && method !== "HEAD") {
    body = await request.arrayBuffer();
    if (body.byteLength > RELAY_BODY_MAX_BYTES) return relayJson(413, "payload_too_large");
  }
  const forwarded = new Request(target, {
    method, headers, ...(body && body.byteLength > 0 ? { body } : {}),
  });
  const response = await relay.dispatch(forwarded);
  const out = new Headers(response.headers);
  out.delete("set-cookie");
  out.set("Cache-Control", "private, no-store");
  return new Response(response.body, { status: response.status, headers: out });
}
