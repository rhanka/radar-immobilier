import { Hono } from "hono";
import type { AuthConfig, TemConfig } from "./config.js";
import {
  authRoute,
  protect,
  type AuthRouteOptions,
} from "./routes/auth.js";
import { healthRoute, type HealthDeps } from "./routes/health.js";
import { contentGate, type ContentReaderMount } from "./artifacts/content-app.js";
import { writeIntentH5Route } from "./artifacts/write-intent-h5-route.js";
import { writeIntentAppRoute } from "./artifacts/write-intent-app-route.js";
import type { ContentHostConfig } from "./artifacts/content-config.js";
import { controlRoute, type ControlRouteDeps } from "./artifacts/control-route.js";
import { uploadPageRoute } from "./artifacts/upload-page-route.js";
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
import { geoGovernedRoute } from "./routes/geo-governed.js";
import { signalsDetailRoute } from "./routes/signals-detail.js";
import { opportunitesRoute } from "./routes/opportunites.js";
import { adminRoute } from "./routes/admin.js";
import { admissionRoute, type AdmissionRouteDeps } from "./admission/route.js";
import { dataQualityRoute, type DataQualityDeps } from "./routes/data-quality.js";
import { sourceCoverageRoute } from "./routes/source-coverage.js";
import { sourceConsistencyRoute } from "./routes/source-consistency.js";
import { prospectMarksRoute } from "./routes/prospect-marks.js";
import { scopedLotCutoverRoute, type ScopedLotCutoverDeps } from "./routes/scoped-lot-cutover.js";
import { scopedLotCutoverActivationRoute } from "./routes/scoped-lot-cutover-activation.js";
import type { LegacyRetirementState } from "./services/facets/legacy-retirement.js";
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
import { mcpSignalSearchRoute } from "./routes/mcp-signal-search.js";
import { classificationBoundary, scopedClassificationRoute } from "./routes/scoped-classification.js";
import type { ClassificationOptions } from "./services/facets/classification-search.js";

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
    /**
     * Lot I1: admission sync wiring. `route` deps mount the signature-
     * authenticated ingest webhook as a public path (see PUBLIC_PREFIXES);
     * absent keeps it closed (503). `trustedIssuers` enables JIT
     * reconciliation at login; `emit` hooks prod-side mutation emission into
     * the admin routes.
     */
    admission?: AdmissionRouteDeps & {
      trustedIssuers: string[];
      emit?: { emit: (targetSub: string) => Promise<{ pushed: boolean }> };
    };
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
    /** Already bound reader; absent keeps content hosts closed. */
    readerContent?: ContentReaderMount;
    readerOpening?: Hono;
    /**
     * Artifact control plane (861c H2); mounted only when auth is enabled.
     * When absent, authenticated mode mounts the closed control capability.
     */
    artifactsControl?: ControlRouteDeps;
    /** Explicit operator mapping and qualified deployment retirement adapter. */
    lotCutover?: Pick<ScopedLotCutoverDeps, "cutoverMapping" | "cutoverSafety">;
    /** Durable server-only retirement; never derived from public input. */
    legacyRetirement?: LegacyRetirementState;
    /** Closed by default; server-only, separately qualified signal binding. */
    mcpSignalSearch?: { enabled: boolean; afterWorkspaceResolve?: () => Promise<void> | void };
    /** Operator-injected read signing configuration; absent keeps pagination closed. */
    classification?: ClassificationOptions;
    /** PW-A write authority; absent keeps prepare/status/confirm closed. */
    writeH5?: Parameters<typeof writeIntentH5Route>[0] | undefined;
    writeApp?: Parameters<typeof writeIntentAppRoute>[0] | undefined;
  };

/** Compose the Hono application from injected dependencies. */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.use("/api/graph-signals/*", privateSignalResponse);
  app.use("/api/v1/signal-facets/*", privateSignalResponse);
  app.use("/api/v1/mcp/facets/signals/*", privateSignalResponse);

  // Content hosts dispatch FIRST, before protect: never app auth or SPA.
  if (deps.contentHost?.enabled) {
    app.use("*", contentGate(deps.contentHost.contentBase, deps.readerContent));
  }

  // J1.2d/e wagon 1 (§14.1): the generic /__app/ relay is NO-GO — the
  // prefix stays reserved and answers an explicit local typed 404 with no
  // upstream call. Registered before protect so the refusal never depends
  // on session state.
  app.all("/__app", (c) => c.json({ error: "not_found" }, 404));
  app.all("/__app/*", (c) => c.json({ error: "not_found" }, 404));

  // Control requests use the official cookie guard before general bearer auth.
  if (deps.auth?.enabled) {
    if (deps.artifactsControl) {
      app.route("/api/v1/artifacts/control", controlRoute(deps.artifactsControl));
      // Browser upload pages (files parity LOT 2) ride the control origin
      // with the same session rules; without the page service the routes
      // stay closed (503 after the cookie/origin checks).
      const { auth, accounts, readActivation, storageScope, uploadPage } = deps.artifactsControl;
      app.route("/api/v1/artifacts", uploadPageRoute({ auth, accounts,
        ...(readActivation ? { readActivation } : {}),
        ...(storageScope ? { storageScope } : {}),
        ...(uploadPage?.service && uploadPage?.config ? { service: uploadPage.service,
          config: { controlOrigin: uploadPage.config.controlOrigin,
            s3Origins: uploadPage.config.s3Origins },
          ...(uploadPage.pages ? { pages: uploadPage.pages } : {}) } : {}) }));
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

  // PW-A write authority: H5 prepare/status and application confirm/revoke.
  // Mounted after contentGate and before protect; absent deps stay closed
  // (503) and never fall back to protect, PUBLIC_PREFIXES, or CORS.
  app.route("/api/v1/artifacts/reader/facets", writeIntentH5Route(deps.writeH5 ?? null));
  app.route("/", writeIntentAppRoute(deps.writeApp ?? null));

  // Auth runs after the content gate, so protect still fronts every business
  // route. When `deps.auth` is absent or disabled both are inert no-ops.
  if (deps.auth?.enabled && deps.readerOpening) app.route("/api/v1/artifacts/reader", deps.readerOpening);
  app.use("/api/v1/workspaces/*", privateSignalResponse);
  app.use("/api/v1/workspaces", privateSignalResponse);
  app.use("/api/v1/workspaces/*", classificationBoundary);
  // Lot I1: the ingest webhook is signature-authenticated (prod holds no
  // preprod session); protect() lets its public path through (PUBLIC_PREFIXES).
  if (deps.admission) {
    app.route("/", admissionRoute(deps.admission));
  }
  if (deps.auth) {
    const admissionIssuers = deps.admission?.trustedIssuers ?? [];
    app.use("*", protect(deps.auth, {
      db: deps.db,
      ...(admissionIssuers.length > 0 ? { admissionTrustedIssuers: admissionIssuers } : {}),
    }));
    // Pass db into authOptions so enrollment runs in production.
    const authOptions: AuthRouteOptions = {
      ...deps.authOptions,
      ...(deps.db ? { db: deps.db } : {}),
      ...(admissionIssuers.length > 0 ? { admissionTrustedIssuers: admissionIssuers } : {}),
    };
    app.route("/", authRoute(deps.auth, authOptions));
    // Admin routes require a live DB.
    if (deps.db) {
      app.route(
        "/",
        adminRoute({
          db: deps.db,
          sessionSecret: deps.auth.sessionSecret,
          ...(deps.admission?.emit ? { admission: deps.admission.emit } : {}),
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
  app.route("/", graphSignalsRoute(deps.legacyRetirement
    ? { ...deps, retirement: deps.legacyRetirement }
    : deps));
  app.route("/", signalFacetsRoute(deps.legacyRetirement
    ? { ...deps, retirement: deps.legacyRetirement }
    : deps));
  app.route("/", workspacesRoute(deps));
  app.route("/", scopedSignalFacetsRoute(deps));
  app.route("/", scopedWorkspaceArchiveRoute(deps));
  app.route("/", scopedProjectionRevisionsRoute(deps));
  app.route("/", scopedProjectionEventsRoute(deps));
  app.route("/", scopedSignalRevealRoute(deps));
  app.route("/", mcpSignalSearchRoute(deps));
  app.route("/", scopedClassificationRoute(deps));
  app.route("/", graphRoute(deps));
  app.route("/", geoLotsRoute());
  app.route("/", geoZonesRoute({ db: deps.db }));
  app.route("/", geoFeaturesRoute({ db: deps.db }));
  app.route("/", geoCollectionsRoute({ db: deps.db }));
  // I-1A governed geo facade (converged r3 §2): frozen path
  // /api/v1/geo-governed, session-gated by protect (NOT a public prefix —
  // never add it to PUBLIC_PREFIXES). The public /api/geo/* prefix above is
  // unchanged and ungated. No P1 credential exists yet, so the contract
  // pointer resolves to `missing source` until the geo tenant operator grants
  // the GEO_SERVED_CONTRACT_S3_* read credential (see runbook).
  app.route(
    "/",
    geoGovernedRoute({
      db: deps.db,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      ...(deps.geoBaseUrl ? { baseUrl: deps.geoBaseUrl } : {}),
      ...(deps.geoListingTtlMs !== undefined ? { listingTtlMs: deps.geoListingTtlMs } : {}),
    }),
  );
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
