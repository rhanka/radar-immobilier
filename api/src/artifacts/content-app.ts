import type { Context, MiddlewareHandler } from "hono";
import { applyContentDenyHeaders } from "./content-deny.js";
import {
  belongsToContentDomain,
  belongsToLegacyContentDomain,
  legacyContentRedirectTarget,
  parseContentHost,
} from "./content-host.js";
import { applyReaderContentHeaders } from "./content-isolation.js";

function deny(c: Context, status: 401 | 404, error: string): Response {
  applyContentDenyHeaders(c);
  return c.json({ error }, status);
}

function pathAndQuery(c: Context): string {
  const url = new URL(c.req.url);
  return `${url.pathname}${url.search}`;
}

/**
 * 301 from the retired immo-pages hosts to the same UUID label on the new
 * base, path and query preserved. The target URL is never logged (it may
 * carry `?grant=`); keep grant params out of access logs as well. Transition
 * only: remove with the legacy Ingress rules per
 * docs/runbooks/ARTIFACTS_PREPROD_ACTIVATION.md ("Legacy redirect removal").
 */
function legacyRedirect(c: Context, contentBase: string): Response {
  const target = legacyContentRedirectTarget(c.req.header("host"), contentBase, pathAndQuery(c));
  if (!target) {
    applyContentDenyHeaders(c);
    return c.json({ error: "not_found" }, 404);
  }
  applyReaderContentHeaders(c);
  c.header("Cache-Control", "private, no-store");
  return c.redirect(target, 301);
}

export interface ContentReaderMount {
  readonly fetch: (req: Request) => Response | Promise<Response>;
}

/**
 * First-chance content-host gate: a content origin never reaches app auth,
 * admin routes or the SPA. /livez and /health bypass the gate for GET and
 * HEAD on every host (kubelet probes); foreign domains keep the chain. Every
 * name in the content domain is reserved, including invalid UUID labels. On a
 * content host, /api/* stays denied (401); page and /__reader/* paths are
 * delegated to the mounted reader when present, otherwise denied with 404.
 * Retired immo-pages hosts answer 301 to the new base (transition only). The
 * default (no mount) preserves the closed boundary.
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
    if (belongsToLegacyContentDomain(host)) return legacyRedirect(c, contentBase);
    if (!belongsToContentDomain(host, contentBase)) return next();
    if (path === "/api" || path.startsWith("/api/")) {
      if (!reader) return deny(c, 401, "unauthenticated");
      applyReaderContentHeaders(c);
      return c.json({ error: "unauthenticated" }, 401);
    }
    // J1.2d/e wagon 1 (§14.1): the /__app/ relay prefix stays reserved and
    // closed — explicit local 404, never delegated to the reader release and
    // never proxied upstream. A published file can never shadow it because
    // the publish policy reserves "__"-prefixed first segments.
    if (path === "/__app" || path.startsWith("/__app/")) {
      return deny(c, 404, "not_found");
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
