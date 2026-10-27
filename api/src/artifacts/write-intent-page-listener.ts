/**
 * PW-C page listener: the two page write operations on the content origin.
 *
 * The page can only reach the H receiver through this listener. It refuses
 * the internal listener-to-API headers when the content supplies them,
 * authenticates the page (P) through the injected write authority, mints a
 * write grant on prepare demand only, and forwards server-to-server with the
 * verified grant plus the page proof extracted from the cookie. Polling never
 * mints or renews a grant. Receiver responses travel back untouched so typed
 * refusals survive to the page.
 */
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { applyReaderContentHeaders, READER_CONTENT_HEADERS } from "./content-isolation.js";
import { parseContentHost } from "./content-host.js";
import { hasDuplicateJsonKeys } from "./write-intent-binding.js";
import { FacetError } from "../services/facets/target.js";
import { writeIntentError } from "./write-intent-errors.js";
import { writeRefusal } from "./write-intent-refusal.js";
import { mintPageWriteGrant, resolveWritePage, type PageWriteAuthorityDeps } from "./write-intent-page-authority.js";
import { assertIdempotencyKey, assertWritePrepareBody } from "./write-intent-schemas.js";
import { PW_PAGE_PREPARE_PATH, PW_PAGE_STATUS_PATH } from "./write-intent-page-gesture.js";

export interface PageListenerDeps extends PageWriteAuthorityDeps {
  /** Content base used to refuse non-content hosts, like the read dispatch. */
  contentBase: string;
  /** Fixed H receiver; same-process sub-app or server-to-server fetch. */
  forward: (req: Request) => Promise<Response>;
  nowMs?: (() => number) | undefined;
}

const INTERNAL_HEADERS = ["x-preview-write-grant", "x-preview-session"];
const FORWARD_BASE = "https://page-write.internal";

function ownOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** The page operations never serve another host, like the read dispatch. */
function foreignHost(c: { req: { header: (name: string) => string | undefined } },
  contentBase: string): boolean {
  return parseContentHost(c.req.header("host"), contentBase).kind === "other";
}

/** Content must never supply the server-to-server proof headers. */
function assertNoInternalHeaders(c: { req: { header: (name: string) => string | undefined } }): void {
  for (const name of INTERNAL_HEADERS) {
    if (c.req.header(name) !== undefined) throw new FacetError(403, "write_grant_required");
  }
}

function forwardHeaders(c: { req: { header: (name: string) => string | undefined } },
  grant: string | null): Headers {
  const headers = new Headers();
  headers.set("content-type", "application/json");
  const cookie = c.req.header("cookie");
  if (cookie !== undefined) headers.set("cookie", cookie);
  if (grant !== null) headers.set("x-preview-write-grant", grant);
  return headers;
}

/** Keep typed upstream outcomes while enforcing the content response policy. */
function forwardedResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(READER_CONTENT_HEADERS)) headers.set(name, value);
  headers.set("Vary", "Cookie, Authorization");
  return new Response(response.body, { status: response.status, headers });
}

export function pageWriteListenerRoute(deps: PageListenerDeps | null): Hono {
  const app = new Hono();
  app.use(PW_PAGE_PREPARE_PATH, bodyLimit({ maxSize: 16 * 1024,
    onError: (c) => writeRefusal(c, "request_too_large", 413, "not_executed", "prepare") }));
  for (const path of [PW_PAGE_PREPARE_PATH, PW_PAGE_STATUS_PATH]) {
    app.use(path, async (c, next) => {
      c.header("Cache-Control", "private, no-store");
      c.header("Vary", "Cookie, Authorization");
      applyReaderContentHeaders(c);
      await next();
    });
  }
  app.post(PW_PAGE_PREPARE_PATH, async (c) => {
    if (!deps) return writeRefusal(c, "write_transport_closed", 503, "not_executed", "prepare");
    if (foreignHost(c, deps.contentBase)) return c.json({ error: "not_found" }, 404);
    try {
      assertNoInternalHeaders(c);
      const origin = c.req.header("origin");
      if (origin !== undefined && origin !== ownOrigin(c.req.url)) {
        throw new FacetError(403, "csrf_refused");
      }
      if (c.req.header("content-encoding") !== undefined) {
        return writeRefusal(c, "unsupported_media_type", 415, "not_executed", "prepare");
      }
      if ((c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase()
        !== "application/json") return writeRefusal(c, "unsupported_media_type", 415, "not_executed", "prepare");
      const raw = await c.req.text();
      if (Buffer.byteLength(raw) > 16 * 1024) return writeRefusal(c, "request_too_large", 413, "not_executed", "prepare");
      if (hasDuplicateJsonKeys(raw)) throw new FacetError(400, "invalid_facet_command");
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new FacetError(400, "invalid_facet_command");
      }
      const key = c.req.header("idempotency-key") ?? "";
      assertIdempotencyKey(key);
      assertWritePrepareBody(body);
      const now = (deps.nowMs ?? Date.now)();
      const page = await resolveWritePage(c, deps, () => now);
      const grant = await mintPageWriteGrant(page, deps, now);
      const headers = forwardHeaders(c, grant);
      headers.set("idempotency-key", key);
      return forwardedResponse(await deps.forward(new Request(`${FORWARD_BASE}/write-intents`,
        { method: "POST", headers, body: raw })));
    } catch (error) {
      return writeIntentError(c, error);
    }
  });
  app.get(PW_PAGE_STATUS_PATH, async (c) => {
    if (!deps) return writeRefusal(c, "write_transport_closed", 503, "not_executed", "status");
    if (foreignHost(c, deps.contentBase)) return c.json({ error: "not_found" }, 404);
    try {
      assertNoInternalHeaders(c);
      const id = c.req.query("intentId") ?? "";
      assertIdempotencyKey(id);
      await resolveWritePage(c, deps, deps.nowMs ?? Date.now);
      return forwardedResponse(await deps.forward(new Request(`${FORWARD_BASE}/write-intents/${id}`,
        { method: "GET", headers: forwardHeaders(c, null) })));
    } catch (error) {
      return writeIntentError(c, error);
    }
  });
  for (const path of [PW_PAGE_PREPARE_PATH, PW_PAGE_STATUS_PATH]) {
    app.all(path, (c) => writeRefusal(c, "method_not_allowed", 405, "not_executed",
      path === PW_PAGE_PREPARE_PATH ? "prepare" : "status"));
  }
  return app;
}
