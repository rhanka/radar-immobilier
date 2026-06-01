import { Hono } from "hono";
import { healthRoute, type HealthDeps } from "./routes/health.js";
import { chatRoute } from "./routes/chat.js";

export type AppDeps = HealthDeps;

/** Compose the Hono application from injected dependencies. */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.route("/", healthRoute(deps));
  app.route("/", chatRoute());

  app.get("/", (c) => c.json({ name: "radar-immobilier-api", status: "up" }));

  return app;
}
