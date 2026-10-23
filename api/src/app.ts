import { Hono } from "hono";
import type { AuthConfig, TemConfig } from "./config.js";
import {
  authRoute,
  protect,
  type AuthRouteOptions,
} from "./routes/auth.js";
import { healthRoute, type HealthDeps } from "./routes/health.js";
import { contentGate } from "./artifacts/content-app.js";
import type { ContentHostConfig } from "./artifacts/content-config.js";
import { controlRoute, type ControlRouteDeps } from "./artifacts/control-route.js";
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
import { geoCollectionsRoute } from "./routes/geo-collections.js";
import { signalsDetailRoute } from "./routes/signals-detail.js";
import { opportunitesRoute } from "./routes/opportunites.js";
import { adminRoute } from "./routes/admin.js";
import { dataQualityRoute, type DataQualityDeps } from "./routes/data-quality.js";
import { sourceCoverageRoute } from "./routes/source-coverage.js";
import { sourceConsistencyRoute } from "./routes/source-consistency.js";
import { prospectMarksRoute } from "./routes/prospect-marks.js";
import { scopedLotCutoverRoute, type ScopedLotCutoverDeps } from "./routes/scoped-lot-cutover.js";
import { scopedLotCutoverActivationRoute } from "./routes/scoped-lot-cutover-activation.js";
import { scopedLotFacetsRoute } from "./routes/scoped-lot-facets.js";
import { signalFacetsRoute } from "./routes/signal-facets.js";
import { privateSignalResponse } from "./services/facets/private-response.js";
import { documentsRoute, type DocumentsDeps } from "./routes/documents.js";
import { workspacesRoute } from "./routes/workspaces.js";
import { scopedSignalFacetsRoute } from "./routes/scoped-signal-facets.js";
import { scopedWorkspaceArchiveRoute } from "./routes/scoped-workspace-archive.js";
import { scopedProjectionRevisionsRoute } from "./routes/scoped-projection-revisions.js";
import { scopedProjectionEventsRoute } from "./routes/scoped-projection-events.js";
import { scopedSignalRevealRoute } from "./routes/scoped-signal-reveal.js";

export type AppDeps = HealthDeps &
  SourcesDeps &
  OntologyDeps &
  CiblageDeps &
  JobsDeps &
  DataQualityDeps &
  DocumentsDeps &
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
    /** Config Scaleway TEM optionnelle pour les emails d'invitation. */
    tem?: TemConfig;
    /**
     * Seams de la couverture sources (source-coverage) : fetch injectable
     * (tests OFFLINE — jamais de réseau en unit), base OGC geo et TTL du cache
     * du listing live. Absents en prod : fetch global + GEO_OGC_BASE_URL.
     */
    fetchImpl?: typeof fetch;
    geoBaseUrl?: string;
    geoListingTtlMs?: number;
    /** Artifact content dispatch (861c); absent/disabled keeps the chain. */
    contentHost?: ContentHostConfig;
    /**
     * Artifact control plane (861c H2); mounted only when auth is enabled.
     * When absent, authenticated mode mounts the closed control capability.
     */
    artifactsControl?: ControlRouteDeps;
    /** Explicit operator mapping and qualified deployment retirement adapter. */
    lotCutover?: Pick<ScopedLotCutoverDeps, "cutoverMapping" | "cutoverSafety">;
  };

/** Compose the Hono application from injected dependencies. */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.use("/api/graph-signals/*", privateSignalResponse);
  app.use("/api/v1/signal-facets/*", privateSignalResponse);

  // Content hosts dispatch FIRST, before protect: never app auth or SPA.
  if (deps.contentHost?.enabled) {
    app.use("*", contentGate(deps.contentHost.contentBase));
  }

  // Control requests use the official cookie guard before general bearer auth.
  if (deps.auth?.enabled) {
    if (deps.artifactsControl) {
      app.route("/api/v1/artifacts/control", controlRoute(deps.artifactsControl));
    } else {
      // Closed capability: same identity guards and cache headers as the
      // mounted route, without storage. The guard returns 503 after the
      // cookie/origin checks, so no account query is needed here.
      app.route("/api/v1/artifacts/control", controlRoute({
        auth: deps.auth,
        accounts: { query: async () => ({ rows: [] }) },
      }));
    }
  }

  // Auth runs after the content gate, so protect still fronts every business
  // route. When `deps.auth` is absent or disabled both are inert no-ops.
  app.use("/api/v1/workspaces/*", privateSignalResponse);
  app.use("/api/v1/workspaces", privateSignalResponse);
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
          ...(deps.tem?.enabled
            ? {
                mailer: {
                  temApiBaseUrl: deps.tem.apiBaseUrl,
                  temRegion: deps.tem.region,
                  temProjectId: deps.tem.projectId,
                  temFromEmail: deps.tem.fromEmail,
                  temFromName: deps.tem.fromName,
                  temSecretKey: deps.tem.secretKey,
                  appBaseUrl: deps.auth.appBaseUrl,
                },
                appBaseUrl: deps.auth.appBaseUrl,
              }
            : { appBaseUrl: deps.auth.appBaseUrl }),
        }),
      );
    }
  }

  app.route("/", healthRoute(deps));
  app.route("/", chatRoute(deps.db));
  app.route("/", automationRoute());
  app.route("/", sourcesRoute(deps));
  app.route("/", ontologyRoute(deps));
  app.route("/", ciblageRoute(deps));
  app.route("/", jobsRoute(deps));
  app.route("/", backlogRoute());
  app.route("/", h2aRoute());
  app.route("/", scrapeStatusRoute(deps.store));
  app.route("/", dataQualityRoute(deps));
  app.route("/", sourceCoverageRoute(deps));
  app.route("/", sourceConsistencyRoute({ db: deps.db }));
  app.route("/", documentsRoute(deps));
  app.route("/", graphSignalsRoute(deps));
  app.route("/", signalFacetsRoute(deps));
  app.route("/", workspacesRoute(deps));
  app.route("/", scopedSignalFacetsRoute(deps));
  app.route("/", scopedWorkspaceArchiveRoute(deps));
  app.route("/", scopedProjectionRevisionsRoute(deps));
  app.route("/", scopedProjectionEventsRoute(deps));
  app.route("/", scopedSignalRevealRoute(deps));
  app.route("/", graphRoute(deps));
  app.route("/", geoLotsRoute());
  app.route("/", geoZonesRoute({ db: deps.db }));
  app.route("/", geoFeaturesRoute({ db: deps.db }));
  app.route("/", geoCollectionsRoute({ db: deps.db }));
  app.route("/", signalsDetailRoute(deps));
  app.route("/", opportunitesRoute(deps));
  app.route("/", prospectMarksRoute(deps.auth?.enabled && deps.auth.sessionSecret ? { db: deps.db, sessionSecret: deps.auth.sessionSecret } : { db: deps.db }));
  // 6K: scoped lot facets and cutover are mounted but self-gating. Lot
  // reads and commands answer 503 until the workspace destination and
  // scoped epoch are established, and stay closed until the explicit
  // operator cutover opens the destination. Legacy mark traffic is fenced
  // at the route layer (503/410) with a database trigger as backstop.
  if (deps.db) {
    const lotDeps = { db: deps.db, ...(deps.auth ? { auth: deps.auth } : {}) };
    app.route("/", scopedLotFacetsRoute({ ...lotDeps, requireCutover: true }));
    app.route("/", scopedLotCutoverRoute({ ...lotDeps, ...deps.lotCutover }));
    app.route("/", scopedLotCutoverActivationRoute({ ...lotDeps, ...deps.lotCutover }));
  }

  app.get("/", (c) => c.json({ name: "radar-immobilier-api", status: "up" }));

  return app;
}
