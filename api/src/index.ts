import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);

// Dependency probes. Real DB and object-store probes are wired in Lots 3/4;
// until then they report ok so the server is bootable end-to-end.
const app = createApp({
  checkDb: async () => ({ ok: true, detail: "stub (wired in Lot 3)" }),
  checkObjectStore: async () => ({ ok: true, detail: "stub (wired in Lot 4)" }),
});

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info({ port: info.port, env: config.NODE_ENV }, "radar-api listening");
});
