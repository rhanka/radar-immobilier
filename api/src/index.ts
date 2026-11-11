import { serve } from "@hono/node-server";
import { readArtifactsEnv } from "@radar/artifacts-host";
import { createApp } from "./app.js";
import { startArtifactControl } from "./artifacts/control-route-startup.js";
import { contentHostAppOption, resolveContentHostConfig } from "./artifacts/content-config.js";
import { createBasketReadOperation } from "./artifacts/reader-baskets.js";
import { createReaderDocumentRead } from "./artifacts/reader-documents.js";
import { createRawDocumentReader } from "./routes/documents.js";
import { createGeoReadOperation } from "./artifacts/reader-geo.js";
import { listGeoCities } from "./services/geo/geo-features.js";
import { createReaderContentApp } from "./artifacts/content-serve.js";
import { createLiveEdgeForward, withLiveEdge } from "./artifacts/live-edge-forward.js";
import { resolveReaderCursorKeyring } from "./artifacts/reader-cursor-keyring.js";
import { createReaderOpening } from "./artifacts/reader-opening.js";
import { consoleReaderEventSink } from "./artifacts/reader-event-log.js";
import { createPublishedWriteRuntime } from "./artifacts/published-write-runtime.js";
import { pageWriteListenerRoute } from "./artifacts/write-intent-page-listener.js";
import { loadConfig, resolveAuthConfig, resolveOpsConfig, resolveTemConfig } from "./config.js";
import { resolveAdmissionConfig } from "./admission/admission-config.js";
import { reconcilePreprodSub } from "./admission/jit.js";
import { pushAdmissionMutation } from "./admission/route.js";
import { createLogger } from "./logger.js";
import { createDb, makeDbProbe } from "./db/client.js";
import { readDurableLegacyRetirement } from "./services/facets/legacy-retirement.js";
import { createDiscardedSignalsReader } from "./services/facets/discarded-reader.js";
import { loadGeoKeyIndex } from "./services/sources/document-resolver.js";
import {
  createObjectStore,
  getGeoDocumentsReader,
  getScrapeObjectStore,
  makeObjectStoreProbe,
} from "./storage/s3-object-store.js";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);

const dbHandle = createDb(config);
const objectStore = createObjectStore(config);

// Dedicated scraping-document store (OVH `radar-immobilier-docs` in production;
// falls back to MinIO locally when SCRAPE_S3_* env vars are not set).
const scrapeObjectStore = getScrapeObjectStore(config);

// immo→geo document repoint (default OFF). Only when GEO_DOCUMENTS_REPOINT=1 do
// we build the read-only geo reader; its dedicated GEO_DOCUMENTS_S3_* wiring is
// then required (resolveGeoDocumentsS3Config throws otherwise — no immo fallback).
const geoDocumentsReader = config.GEO_DOCUMENTS_REPOINT
  ? getGeoDocumentsReader(config)
  : undefined;
const geoKeyIndex = config.GEO_DOCUMENTS_REPOINT
  ? loadGeoKeyIndex(config.GEO_DOCUMENTS_INDEX_PATH)
  : undefined;
logger.info(
  { geoDocumentsRepoint: config.GEO_DOCUMENTS_REPOINT },
  config.GEO_DOCUMENTS_REPOINT
    ? "immo→geo document repoint ENABLED (PV PDFs served read-only from geo)"
    : "immo→geo document repoint disabled (PV PDFs served from immo store)",
);

// Resolve the OIDC relying-party config. `enabled` is false unless the
// deployment injected the IdP wiring + secrets — local dev stays OPEN.
const auth = resolveAuthConfig(config);
logger.info(
  { authEnabled: auth.enabled, issuer: auth.enabled ? auth.issuer : undefined },
  auth.enabled
    ? "OIDC relying-party enabled (login required)"
    : "OIDC relying-party disabled (open mode — no login)",
);

// Lot I1 (R1): admission sync prod -> preprod. Fail-closed on both sides:
// the preprod webhook answers only when enabled with prod public keys; the
// prod private key exists ONLY in prod (k8s Secret `radar-admission-signing`).
const admission = resolveAdmissionConfig(config);
logger.info(
  {
    syncEnabled: admission.syncEnabled,
    trustedIssuers: admission.trustedIssuers.length,
    signing: admission.signingKey !== undefined,
    push: admission.pushUrl !== "",
  },
  admission.syncEnabled
    ? "admission sync ingest enabled (signature-verified preprod webhook)"
    : admission.signingKey
      ? "admission sync emitter armed (prod snapshot signing + push)"
      : "admission sync disabled (closed by default)",
);

// Resolve optional Scaleway TEM config for invitation emails. SMTP egress is
// blocked at the platform level (BR-37b), so mail goes through the TEM HTTP API.
const tem = resolveTemConfig(config);
logger.info(
  { temEnabled: tem.enabled, temRegion: tem.enabled ? tem.region : undefined },
  tem.enabled
    ? "Scaleway TEM mailer enabled (invitation emails will be sent via HTTP API)"
    : "Scaleway TEM mailer disabled (invitation links will be logged to stdout)",
);

// Optional artifact content origin (861c). Closed by default: unset or empty
// keeps the current chain. An explicit but malformed ARTIFACTS_CONTENT_BASE
// throws here and stops startup (fail-fast, never silently disabled).
const contentHost = resolveContentHostConfig({
  contentBase: process.env["ARTIFACTS_CONTENT_BASE"],
});
logger.info(
  contentHost.enabled ? { contentBase: contentHost.contentBase } : { reason: contentHost.reason },
  contentHost.enabled ? "artifact content host enabled" : "artifact content host disabled (closed by default)",
);

const artifactsControl = await startArtifactControl({
  input: readArtifactsEnv(), auth, logger,
  contentBase: contentHost.enabled ? contentHost.contentBase : undefined,
  poolParams: {
    host: config.POSTGRES_HOST, port: config.POSTGRES_PORT, user: config.POSTGRES_USER,
    password: config.POSTGRES_PASSWORD, database: config.POSTGRES_DB,
  },
});

// Share the publication host's scoped PostgreSQL authority and S3 blobs.
const readerGrantSecret = (process.env["ARTIFACTS_READER_GRANT_SECRET"] ?? "").trim();
const readerSessionSecret = (process.env["ARTIFACTS_READER_SESSION_SECRET"] ?? "").trim();
const readerCursorKeyring = resolveReaderCursorKeyring(process.env);
const readerIssuer = {
  issuer: (process.env["ARTIFACTS_READER_ISSUER"] ?? (auth.enabled ? auth.appBaseUrl : "")).trim(),
  audience: (process.env["ARTIFACTS_READER_AUDIENCE"] ?? (auth.enabled ? `${auth.appBaseUrl}/reader` : "")).trim(),
  tier: (process.env["ARTIFACTS_READER_TIER"] ?? config.NODE_ENV).trim(),
};
const publishedWrite = contentHost.enabled && artifactsControl?.readerStorage && artifactsControl.storageScope
  ? createPublishedWriteRuntime({ db: dbHandle.db, auth, accounts: artifactsControl.accounts,
    storage: artifactsControl.readerStorage, scope: artifactsControl.storageScope, contentBase: contentHost.contentBase,
    readIssuer: readerIssuer, readGrantSecret: readerGrantSecret, sessionSecret: readerSessionSecret, env: process.env,
    ...(artifactsControl.readerConsent ? { consent: artifactsControl.readerConsent } : {}) }) : null;
const readerOpening = contentHost.enabled && artifactsControl?.readerStorage && auth.enabled &&
  readerGrantSecret.length >= 32 && readerSessionSecret.length >= 32
  ? createReaderOpening({ ...artifactsControl.readerStorage, auth, contentBase: contentHost.contentBase,
    issuer: readerIssuer, grantSecret: readerGrantSecret, sessionSecret: readerSessionSecret,
    ...(artifactsControl.readerConsent ? { consent: artifactsControl.readerConsent } : {}),
    // J1.3a: typed reader journal (closed shape, no city/signal/query).
    events: consoleReaderEventSink,
    ...(publishedWrite ? { writeDomain: publishedWrite.domain, permitsWrite: publishedWrite.permitsWrite } : {}),
    // Lot I1 (R1/a): JIT before getRights; disabled without trusted issuers.
    ...(admission.trustedIssuers.length > 0
      ? { reconcile: (input: { sub: string; email?: string; emailVerified: boolean; issuer: string }) =>
        reconcilePreprodSub(dbHandle.db, input, { trustedIssuers: admission.trustedIssuers }) }
      : {}) }) : undefined;
logger.info(
  {
    readerWired: !!readerOpening,
    cursorKeyring: readerCursorKeyring ? "configured" : "absent",
  },
  readerOpening
    ? readerCursorKeyring
      ? "artifact reader mounted in API with basket bridge and cursor keyring"
      : "artifact reader mounted in API without cursor keyring (search closed with transport_unavailable)"
    : "artifact reader not mounted (closed by default)",
);
// I-1B (converged-geo-mesh r3 §2): the governed catalogue operations ride
// the same reader dispatch on the `geo.read` capability. The basket bridge
// keeps workspace-scoped reads; the geo service answers catalogue reads.
// Municipal, non-personal data — no basket consent (see reader-geo.ts).
const basketReadOperation = createBasketReadOperation({
  db: dbHandle.db,
  store: objectStore,
  ...(readerSessionSecret.length >= 32 ? { tokenSecret: readerSessionSecret } : {}),
  ...(readerCursorKeyring ? { classification: { cursorKeyring: readerCursorKeyring } } : {}),
});
// J1.2d/e §11.3: the reader PDF op resolves through the same raw stores as
// the app route (scrape store first, geo repoint when enabled), but only from
// a doc-ref of a signal the reader can see.
const readerDocumentRead = createReaderDocumentRead({
  db: dbHandle.db,
  store: objectStore,
  readRaw: createRawDocumentReader({
    store: objectStore,
    scrapeStore: scrapeObjectStore,
    geoDocumentsRepoint: config.GEO_DOCUMENTS_REPOINT,
    ...(geoDocumentsReader ? { geoDocumentsReader } : {}),
    ...(geoKeyIndex ? { geoKeyIndex } : {}),
  }),
});
const geoReadOperation = createGeoReadOperation({
  listCitiesImpl: () => listGeoCities(dbHandle.db),
});
// Generic relay dispatch is late-bound: the reader app is created before
// the application it forwards to; every relayed call resolves the composed
// app at request time (503 until the binding lands, never at boot).
const relayBinding: { dispatch?: (request: Request) => Promise<Response> | Response } = {};
const readerContent = contentHost.enabled && artifactsControl?.readerStorage && readerGrantSecret.length >= 32 && readerSessionSecret.length >= 32
  ? createReaderContentApp({
    contentBase: contentHost.contentBase,
    grantSecret: readerGrantSecret,
    sessionSecret: readerSessionSecret,
    issuer: readerIssuer,
    pageWrite: publishedWrite?.pageWrite ?? pageWriteListenerRoute(null),
    // Gate B: the H5 dispatch re-reads the durable baskets consent on
    // every business call (revocation effective at the next call).
    ...(artifactsControl.readerConsent ? { basketConsent: artifactsControl.readerConsent } : {}),
    readerEvents: consoleReaderEventSink,
    ...(readerOpening ? { openingContent: readerOpening.content } : {}),
    ...artifactsControl.readerStorage,
    readDocument: readerDocumentRead,
    readOperation: async (op, params, context) => {
      if (op === "geo.cities.v1" || op === "geo.collection-items.v1") return geoReadOperation(op, params);
      return basketReadOperation(op, params, context);
    },
    relay: {
      appOrigin: auth.enabled && auth.appBaseUrl ? auth.appBaseUrl : "https://app.invalid",
      appSessionSecret: auth.enabled ? auth.sessionSecret : "",
      dispatch: (request) => relayBinding.dispatch
        ? relayBinding.dispatch(request)
        : new Response(JSON.stringify({ ok: false, error: "capability_unavailable" }), {
          status: 503, headers: { "Content-Type": "application/json" } }),
    },
  })
  : undefined;

// Live edge forward (A-LIVE §8.2): composed only at stage `live` with
// IMMO_ARTIFACTS_LIVE_EDGE_ENABLED=1, on the reader mount (content hosts only).
// The principal is the release reader verified by the SAME code path as the
// release (content-serve.ts authorized: sealed host, issuer, audience, tier,
// session revocation), bound to this artifact host.
const liveEdge = readerContent && contentHost.enabled && artifactsControl?.liveEdge
  ? createLiveEdgeForward({ contentBase: contentHost.contentBase, ports: artifactsControl.liveEdge,
    principal: async (request, artifactId) => {
      const reader = await readerContent.liveReader(request);
      return reader && reader.artifactId === artifactId ? reader.readerSub : null;
    } })
  : undefined;
const servedReader = readerContent && liveEdge ? withLiveEdge(readerContent, liveEdge) : readerContent;

const durableRetirement = await readDurableLegacyRetirement(dbHandle.db).catch((error) => {
  logger.warn({ err: String(error) }, "durable retirement unreadable; starting closed");
  return "cutover-closed" as const;
});

// Lot I1: prod mutation emission (signing key + push URL present = prod).
const signingKey = admission.signingKey;
const admissionEmit = signingKey && admission.pushUrl !== ""
  ? {
    emit: (targetSub: string) => pushAdmissionMutation({
      db: dbHandle.db,
      kid: signingKey.kid,
      key: signingKey.key,
      pushUrl: admission.pushUrl,
    }, targetSub),
  }
  : undefined;

const app = createApp({
  checkDb: makeDbProbe(dbHandle),
  checkObjectStore: makeObjectStoreProbe(objectStore),
  admission: {
    db: dbHandle.db,
    enabled: admission.syncEnabled,
    publicKeys: admission.publicKeys,
    trustedIssuers: admission.trustedIssuers,
    ...(admissionEmit ? { emit: admissionEmit } : {}),
  },
  store: objectStore,
  scrapeStore: scrapeObjectStore,
  geoDocumentsRepoint: config.GEO_DOCUMENTS_REPOINT,
  ...(geoDocumentsReader ? { geoDocumentsReader } : {}),
  ...(geoKeyIndex ? { geoKeyIndex } : {}),
  ontologyWriteToken: config.RADAR_ONTOLOGY_WRITE_TOKEN,
  db: dbHandle.db,
  discarded: createDiscardedSignalsReader(dbHandle.db),
  auth,
  tem,
  ops: (() => {
    const ops = resolveOpsConfig(config);
    return {
      db: dbHandle.db,
      ...(ops.recipientsBearer ? { bearer: ops.recipientsBearer } : {}),
      ...(ops.expectedTarget ? { expectedTarget: ops.expectedTarget } : {}),
      ...(ops.referenceWorkspaceSlug
        ? { referenceWorkspaceSlug: ops.referenceWorkspaceSlug }
        : {}),
    };
  })(),
  mcpSignalSearch: { enabled: config.MCP_SIGNAL_SEARCH_ENABLED },
  ...(durableRetirement ? { legacyRetirement: durableRetirement } : {}),
  ...contentHostAppOption(contentHost),
  ...(servedReader ? { readerContent: servedReader } : {}),
  ...(readerOpening ? { readerOpening: readerOpening.application } : {}),
  ...(publishedWrite ? { writeH5: publishedWrite.h5, writeApp: publishedWrite.application } : {}),
  ...(readerCursorKeyring ? { classification: { cursorKeyring: readerCursorKeyring } } : {}),
  ...(artifactsControl ? { artifactsControl } : {}),
});
relayBinding.dispatch = (request) => app.fetch(request);

// Ensure the raw-metadata bucket exists before serving RECUEIL collect requests.
void objectStore
  .ensureBucket()
  .catch((e) => logger.warn({ err: String(e) }, "ensureBucket failed"));

// Ensure the scraping-document bucket exists (creates it on MinIO locally;
// on OVH the bucket is pre-created and this becomes a no-op HeadBucket).
void scrapeObjectStore
  .ensureBucket()
  .catch((e) =>
    logger.warn({ err: String(e) }, "ensureBucket (scrape) failed"),
  );

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info({ port: info.port, env: config.NODE_ENV }, "radar-api listening");
});
// Websocket upgrades exist only for the live HMR route; anything else is closed as before.
if (liveEdge) {
  server.on("upgrade", (incoming, socket, head) => {
    // Node removes its socket error handler on upgrade: never let a reset escape.
    socket.on("error", () => socket.destroy());
    liveEdge.upgrade(incoming, socket, head).then((handled) => { if (!handled) socket.destroy(); }, () => socket.destroy());
  });
}
