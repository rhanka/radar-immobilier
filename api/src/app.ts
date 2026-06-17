import { Hono } from "hono";
import type { AuthConfig } from "./config.js";
import {
  authRoute,
  protect,
  type AuthRouteOptions,
} from "./routes/auth.js";
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
import { graphSignalsRoute, type GraphSignalsDeps } from "./routes/graph-signals.js";
import { geoLotsRoute } from "./routes/geo-lots.js";
import { geoZonesRoute } from "./routes/geo-zones.js";
import { geoFeaturesRoute, type GeoFeaturesDeps } from "./routes/geo-features.js";
import { signalsDetailRoute } from "./routes/signals-detail.js";
import { opportunitesRoute } from "./routes/opportunites.js";
import { adminRoute } from "./routes/admin.js";
import { dataQualityRoute, type DataQualityDeps } from "./routes/data-quality.js";
import { prospectMarksRoute } from "./routes/prospect-marks.js";

export type AppDeps = HealthDeps &
  SourcesDeps &
  OntologyDeps &
  CiblageDeps &
  JobsDeps &
  DataQualityDeps &
  GraphDeps &
  GraphSignalsDeps &
  GeoFeaturesDeps & {
    /**
     * Resolved OIDC relying-party config. Optional: when absent (or
     * `enabled === false`) the app runs OPEN — no login required — which keeps
     * local dev and tests unchanged. The deployment injects an enabled config
     * via env (see config.resolveAuthConfig + deploy/k8s/30-api.yaml).
     */
    auth?: AuthConfig;
    /** Test seams for the OIDC routes (mock fetch / JWKS / discovery). */
    authOptions?: AuthRouteOptions;
  };

/** Compose the Hono application from injected dependencies. */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  // Auth is wired first so the protect middleware runs before every business
  // route. When `deps.auth` is absent or disabled both are inert no-ops.
  if (deps.auth) {
    app.use("*", protect(deps.auth, { db: deps.db }));
    // Pass db into authOptions so enrollment runs in production.
    const authOptions: AuthRouteOptions = {
      ...deps.authOptions,
      ...(deps.db ? { db: deps.db } : {}),
    };
    app.route("/", authRoute(deps.auth, authOptions));
    // Admin routes require a live DB.
    if (deps.db) {
      app.route(
        "/",
        adminRoute({
          db: deps.db,
          sessionSecret: deps.auth.sessionSecret,
        }),
      );
    }
  }

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
  app.route("/", dataQualityRoute(deps));
  app.route("/", graphSignalsRoute(deps));
  app.route("/", graphRoute(deps));
  app.route("/", geoLotsRoute());
  app.route("/", geoZonesRoute({ db: deps.db }));
  app.route("/", geoFeaturesRoute({ db: deps.db }));
  app.route("/", signalsDetailRoute(deps));
  app.route("/", opportunitesRoute(deps));
  app.route("/", prospectMarksRoute(deps.auth?.enabled && deps.auth.sessionSecret ? { db: deps.db, sessionSecret: deps.auth.sessionSecret } : { db: deps.db }));

  app.get("/", (c) => c.json({ name: "radar-immobilier-api", status: "up" }));

  return app;
}
