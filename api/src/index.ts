import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createDb, makeDbProbe } from "./db/client.js";
import {
  createObjectStore,
  getScrapeObjectStore,
  makeObjectStoreProbe,
} from "./storage/s3-object-store.js";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);

const dbHandle = createDb(config);
const objectStore = createObjectStore(config);

// Dedicated scraping-document store (SCW `radar-immobilier-docs` in production;
// falls back to MinIO locally when SCRAPE_S3_* env vars are not set).
const scrapeObjectStore = getScrapeObjectStore(config);

const app = createApp({
  checkDb: makeDbProbe(dbHandle),
  checkObjectStore: makeObjectStoreProbe(objectStore),
  store: objectStore,
  scrapeStore: scrapeObjectStore,
  ontologyWriteToken: config.RADAR_ONTOLOGY_WRITE_TOKEN,
  db: dbHandle.db,
});

// Ensure the raw-metadata bucket exists before serving RECUEIL collect requests.
void objectStore
  .ensureBucket()
  .catch((e) => logger.warn({ err: String(e) }, "ensureBucket failed"));

// Ensure the scraping-document bucket exists (creates it on MinIO locally;
// on SCW the bucket is pre-created and this becomes a no-op HeadBucket).
void scrapeObjectStore
  .ensureBucket()
  .catch((e) =>
    logger.warn({ err: String(e) }, "ensureBucket (scrape) failed"),
  );

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info({ port: info.port, env: config.NODE_ENV }, "radar-api listening");
});
