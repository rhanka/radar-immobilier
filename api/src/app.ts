import { Hono } from "hono";
import { healthRoute, type HealthDeps } from "./routes/health.js";
import { chatRoute } from "./routes/chat.js";
import { automationRoute } from "./routes/automation.js";
import { sourcesRoute, type SourcesDeps } from "./routes/sources.js";
import { ontologyRoute, type OntologyDeps } from "./routes/ontology.js";
import { ciblageRoute, type CiblageDeps } from "./routes/ciblage.js";
import { jobsRoute, type JobsDeps } from "./routes/jobs.js";
import { backlogRoute } from "./routes/backlog.js";
import { h2aRoute } from "./routes/h2a.js";
import { scrapeStatusRoute } from "./routes/scrape-status.js";
import { graphRoute, type GraphDeps } from "./routes/graph.js";
import { geoLotsRoute } from "./routes/geo-lots.js";
import { signalsDetailRoute } from "./routes/signals-detail.js";
import { opportunitesRoute } from "./routes/opportunites.js";

export type AppDeps = HealthDeps &
  SourcesDeps &
  OntologyDeps &
  CiblageDeps &
  JobsDeps &
  GraphDeps;

/** Compose the Hono application from injected dependencies. */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.route("/", healthRoute(deps));
  app.route("/", chatRoute());
  app.route("/", automationRoute());
  app.route("/", sourcesRoute(deps));
  app.route("/", ontologyRoute(deps));
  app.route("/", ciblageRoute(deps));
  app.route("/", jobsRoute(deps));
  app.route("/", backlogRoute());
  app.route("/", h2aRoute());
  app.route("/", scrapeStatusRoute(deps.store));
  app.route("/", graphRoute(deps));
  app.route("/", geoLotsRoute());
  app.route("/", signalsDetailRoute(deps));
  app.route("/", opportunitesRoute(deps));

  app.get("/", (c) => c.json({ name: "radar-immobilier-api", status: "up" }));

  return app;
}
