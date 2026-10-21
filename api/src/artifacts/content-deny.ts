import { Hono } from "hono";
import type { Context } from "hono";

/**
 * Shared content denial response (861c lots H1/H3). The H1 API gate
 * (content-app.ts) and the standalone H3 denial listener both answer with
 * these headers and bodies, so the closed boundary stays identical in both
 * modes. This module imports ONLY hono: no config, database, object store,
 * authentication, session, credential or domain-policy dependency.
 */
export const CONTENT_DENY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Resource-Policy": "same-origin",
};

/** Apply the shared denial headers to a response context. */
export function applyContentDenyHeaders(c: Context): void {
  for (const [name, value] of Object.entries(CONTENT_DENY_HEADERS)) {
    c.header(name, value);
  }
}

function deny(c: Context, status: 401 | 404, error: string): Response {
  applyContentDenyHeaders(c);
  return c.json({ error }, status);
}

/**
 * Standalone content denial application (861c lot H3 unit 8). Denies EVERY
 * request unconditionally — valid stable/pinned hosts, malformed names,
 * foreign hosts and missing bases alike — without parsing the Host header
 * and without any application dependency. Only minimal GET/HEAD liveness
 * and readiness probes are served; everything else receives the shared
 * denial (401 under /api/*, 404 elsewhere). Never redirects, never serves
 * HTML or the SPA, never emits a cookie.
 */
export function createContentDenyApp(): Hono {
  const app = new Hono();
  app.use("*", async (c): Promise<Response> => {
    const path = c.req.path;
    const method = c.req.method;
    if (
      (path === "/livez" || path === "/health") &&
      (method === "GET" || method === "HEAD")
    ) {
      // HEAD carries no body even if the framework preserves GET bodies.
      if (method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return c.json({ status: "ok" }, 200);
    }
    if (path.startsWith("/api/")) return deny(c, 401, "unauthenticated");
    return deny(c, 404, "not_found");
  });
  return app;
}
