import type { Context, MiddlewareHandler } from "hono";
import { applyContentDenyHeaders } from "./content-deny.js";
import { parseContentHost } from "./content-host.js";

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
 * (kubelet probes); any other host keeps the chain. On a content host,
 * /api/* stays denied (401); page and /__reader/* paths are delegated to
 * the mounted reader when present, otherwise denied with 404. The default
 * (no mount) preserves the closed H1/H3 boundary byte-for-byte.
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
    if (parseContentHost(c.req.header("host"), contentBase).kind === "other") return next();
    if (path.startsWith("/api/")) return deny(c, 401, "unauthenticated");
    if (reader) return reader.fetch(c.req.raw);
    return deny(c, 404, "not_found");
  };
}
