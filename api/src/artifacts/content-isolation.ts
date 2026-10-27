/**
 * Content isolation helpers (ARTEFACTS A6/H5).
 *
 * Served pages carry isolation headers, `private, no-store` sensitive
 * responses and service-worker refusal on every path including fallbacks.
 * Embedding stays unavailable. Publisher/MCP credentials never enter
 * served bytes or headers.
 *
 * L3 release CSP: published HTML/CSS/JS sets load as same-origin
 * sub-resources (script-src/style-src 'self') and call H5 over the same
 * origin (connect-src 'self'). The technical example inline script stays
 * allowed by hash. Workers, frames and objects stay refused.
 */
import type { Context, MiddlewareHandler } from "hono";
import { RELEASE_CSP } from "./release-files.js";

export const READER_CONTENT_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy": RELEASE_CSP,
};

export function applyReaderContentHeaders(c: Context): void {
  for (const [name, value] of Object.entries(READER_CONTENT_HEADERS)) {
    c.header(name, value);
  }
}

const SERVICE_WORKER_PATHS = ["/sw.js", "/service-worker.js"];

export function isServiceWorkerPath(path: string): boolean {
  return SERVICE_WORKER_PATHS.includes(path) || path.startsWith("/__reader/sw");
}

export function isEmbedPath(path: string): boolean {
  return path === "/embed" || path.startsWith("/embed/");
}

export function servedBodyLeaksCredentials(body: string): boolean {
  const lowered = body.toLowerCase();
  return (
    lowered.includes("radar_session") ||
    lowered.includes("mcp-credential") ||
    lowered.includes("publisher-secret")
  );
}

export const refuseServiceWorker: MiddlewareHandler = async (c, next) => {
  if (isServiceWorkerPath(c.req.path) || isEmbedPath(c.req.path)) {
    applyReaderContentHeaders(c);
    return c.json({ error: "not_found" }, 404);
  }
  return next();
};
