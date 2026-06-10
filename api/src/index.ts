import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createDb, makeDbProbe } from "./db/client.js";
import {
  createObjectStore,
  makeObjectStoreProbe,
} from "./storage/s3-object-store.js";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);

const dbHandle = createDb(config);
const objectStore = createObjectStore(config);

const app = createApp({
  checkDb: makeDbProbe(dbHandle),
  checkObjectStore: makeObjectStoreProbe(objectStore),
  store: objectStore,
  ontologyWriteToken: config.RADAR_ONTOLOGY_WRITE_TOKEN,
  db: dbHandle.db,
});

// Ensure the raw bucket exists before serving RECUEIL collect requests.
void objectStore
  .ensureBucket()
  .catch((e) => logger.warn({ err: String(e) }, "ensureBucket failed"));

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info({ port: info.port, env: config.NODE_ENV }, "radar-api listening");
});
