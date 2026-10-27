import type { Context, MiddlewareHandler } from "hono";
import { applyContentDenyHeaders } from "./content-deny.js";
import { belongsToContentDomain, parseContentHost } from "./content-host.js";
import { applyReaderContentHeaders } from "./content-isolation.js";

function deny(c: Context, status: 401 | 404, error: string): Response {
  applyContentDenyHeaders(c);
  return c.json({ error }, status);
}

/**
 * First-chance content-host gate (861c lot H1): a content origin never
 * reaches app auth, admin routes or the SPA. /livez and /health bypass the
 * gate for GET and HEAD on every host (kubelet probes); any other host keeps
 * the chain.
 */
export interface ContentReaderMount {
  readonly fetch: (req: Request) => Response | Promise<Response>;
}

/**
 * First-chance content-host gate (861c lot H1, extended ARTEFACTS A6/H5):
 * a content origin never reaches app auth, admin routes or the SPA.
 * /livez and /health bypass the gate for GET and HEAD on every host
 * (kubelet probes); foreign domains keep the chain. Every name in the content
 * domain is reserved, including invalid UUID labels. On a content host,
 * /api/* stays denied (401); page and /__reader/* paths are delegated to
 * the mounted reader when present, otherwise denied with 404. The default
 * (no mount) preserves the closed H1/H3 boundary.
 */
export function contentGate(contentBase: string, reader?: ContentReaderMount): MiddlewareHandler {
  return async (c, next) => {
    const path = c.req.path;
    const method = c.req.method;
    if (
      (path === "/livez" || path === "/health") &&
      (method === "GET" || method === "HEAD")
    ) {
      return next();
    }
    const host = c.req.header("host");
    if (!belongsToContentDomain(host, contentBase)) return next();
    if (path === "/api" || path.startsWith("/api/")) {
      if (!reader) return deny(c, 401, "unauthenticated");
      applyReaderContentHeaders(c);
      return c.json({ error: "unauthenticated" }, 401);
    }
    if (parseContentHost(host, contentBase).kind === "other" || /^\/(app|admin|auth|login)(\/|$)/.test(path)) {
      if (!reader) return deny(c, 404, "not_found");
      applyReaderContentHeaders(c);
      return c.json({ error: "not_found" }, 404);
    }
    if (reader) return reader.fetch(c.req.raw);
    return deny(c, 404, "not_found");
  };
}
