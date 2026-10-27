import type { MiddlewareHandler } from "hono";

/**
 * Control-surface cache policy (861C §5.3, T29).
 *
 * Every control response is private and never stored: successes, receipts,
 * refusals, validation errors and unavailable-backend responses alike. The
 * Vary includes the caller's credentials and preserves existing dimensions.
 */
export const CONTROL_CACHE_CONTROL = "private, no-store";
export const CONTROL_VARY = "Cookie, Authorization";

export const controlCacheHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  // Stamp the final response, including a replacement from an error handler.
  c.header("Cache-Control", CONTROL_CACHE_CONTROL);
  const vary = (c.res.headers.get("Vary") ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  for (const name of CONTROL_VARY.split(", ")) {
    if (!vary.some((v) => v.toLowerCase() === name.toLowerCase())) vary.push(name);
  }
  c.header("Vary", vary.join(", "));
};
