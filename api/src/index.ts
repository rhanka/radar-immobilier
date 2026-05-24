import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createDb, makeDbProbe } from "./db/client.js";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);

const dbHandle = createDb(config);

// Object-store probe is wired in Lot 4; until then it reports ok.
const app = createApp({
  checkDb: makeDbProbe(dbHandle),
  checkObjectStore: async () => ({ ok: true, detail: "stub (wired in Lot 4)" }),
});

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info({ port: info.port, env: config.NODE_ENV }, "radar-api listening");
});
