import type { MiddlewareHandler } from "hono";

export const privateSignalResponse: MiddlewareHandler = async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  c.header("Vary", "Cookie, Authorization");
  await next();
};
