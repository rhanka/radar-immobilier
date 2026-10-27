import { serve } from "@hono/node-server";
import { readArtifactsEnv } from "@radar/artifacts-host";
import { createApp } from "./app.js";
import { startArtifactControl } from "./artifacts/control-route-startup.js";
import { contentHostAppOption, resolveContentHostConfig } from "./artifacts/content-config.js";
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

// Optional artifact control plane (861c lot H2): storage + publication.
// Absent ARTIFACTS_* stays disabled (control routes absent, current chain
// unchanged). Partial configuration closes the capability; malformed supplied
// values stop startup. No storage is initialized when authentication is off.
const artifactsControl = await startArtifactControl({
  input: readArtifactsEnv(), auth, logger,
  contentBase: contentHost.enabled ? contentHost.contentBase : undefined,
  poolParams: {
    host: config.POSTGRES_HOST,
    port: config.POSTGRES_PORT,
    user: config.POSTGRES_USER,
    password: config.POSTGRES_PASSWORD,
    database: config.POSTGRES_DB,
  },
});

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
