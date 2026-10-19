import type { Context, MiddlewareHandler } from "hono";
import { parseContentHost } from "./content-host.js";

/**
 * First-chance content-host gate (861c lot H1): a content origin never
 * reaches app auth, admin routes or the SPA. /livez and /health bypass the
 * gate on every host (kubelet probes); any other host keeps the chain.
 */
const DENY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Resource-Policy": "same-origin",
};

function deny(c: Context, status: 401 | 404, error: string): Response {
  for (const [name, value] of Object.entries(DENY_HEADERS)) {
    c.header(name, value);
  }
  return c.json({ error }, status);
}

export function contentGate(contentBase: string): MiddlewareHandler {
  return async (c, next) => {
    const path = c.req.path;
    if (path === "/livez" || path === "/health") return next();
    if (parseContentHost(c.req.header("host"), contentBase).kind === "other") return next();
    if (path.startsWith("/api/")) return deny(c, 401, "unauthenticated");
    return deny(c, 404, "not_found");
  };
}
