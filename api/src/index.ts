import { serve } from "@hono/node-server";
import { readArtifactsEnv } from "@radar/artifacts-host";
import { createApp } from "./app.js";
import { startArtifactControl } from "./artifacts/control-route-startup.js";
import { contentHostAppOption, resolveContentHostConfig } from "./artifacts/content-config.js";
import { createBasketReadOperation } from "./artifacts/reader-baskets.js";
import { createReaderContentApp } from "./artifacts/content-serve.js";
import { resolveReaderCursorKeyring } from "./artifacts/reader-cursor-keyring.js";
import { createReaderOpening } from "./artifacts/reader-opening.js";
import { createPublishedWriteRuntime } from "./artifacts/published-write-runtime.js";
import { pageWriteListenerRoute } from "./artifacts/write-intent-page-listener.js";
import { loadConfig, resolveAuthConfig, resolveTemConfig } from "./config.js";
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
    readIssuer: readerIssuer, readGrantSecret: readerGrantSecret, sessionSecret: readerSessionSecret, env: process.env }) : null;
const readerOpening = contentHost.enabled && artifactsControl?.readerStorage && auth.enabled &&
  readerGrantSecret.length >= 32 && readerSessionSecret.length >= 32
  ? createReaderOpening({ ...artifactsControl.readerStorage, auth, contentBase: contentHost.contentBase,
    issuer: readerIssuer, grantSecret: readerGrantSecret, sessionSecret: readerSessionSecret,
    ...(publishedWrite ? { writeDomain: publishedWrite.domain, permitsWrite: publishedWrite.permitsWrite } : {}) }) : undefined;
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
const readerContent = contentHost.enabled && artifactsControl?.readerStorage && readerGrantSecret.length >= 32 && readerSessionSecret.length >= 32
  ? createReaderContentApp({
    contentBase: contentHost.contentBase,
    grantSecret: readerGrantSecret,
    sessionSecret: readerSessionSecret,
    issuer: readerIssuer,
    pageWrite: publishedWrite?.pageWrite ?? pageWriteListenerRoute(null),
    ...(readerOpening ? { openingContent: readerOpening.content } : {}),
    ...artifactsControl.readerStorage,
    readOperation: createBasketReadOperation({
      db: dbHandle.db,
      store: objectStore,
      ...(readerCursorKeyring ? { classification: { cursorKeyring: readerCursorKeyring } } : {}),
    }),
  })
  : undefined;

const durableRetirement = await readDurableLegacyRetirement(dbHandle.db).catch((error) => {
  logger.warn({ err: String(error) }, "durable retirement unreadable; starting closed");
  return "cutover-closed" as const;
});

const app = createApp({
  checkDb: makeDbProbe(dbHandle),
  checkObjectStore: makeObjectStoreProbe(objectStore),
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
  mcpSignalSearch: { enabled: config.MCP_SIGNAL_SEARCH_ENABLED },
  ...(durableRetirement ? { legacyRetirement: durableRetirement } : {}),
  ...contentHostAppOption(contentHost),
  ...(readerContent ? { readerContent } : {}),
  ...(readerOpening ? { readerOpening: readerOpening.application } : {}),
  ...(publishedWrite ? { writeH5: publishedWrite.h5, writeApp: publishedWrite.application } : {}),
  ...(readerCursorKeyring ? { classification: { cursorKeyring: readerCursorKeyring } } : {}),
  ...(artifactsControl ? { artifactsControl } : {}),
});

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

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info({ port: info.port, env: config.NODE_ENV }, "radar-api listening");
});
