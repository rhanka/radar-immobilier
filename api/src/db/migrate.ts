import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client.js";
import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const { db, pool } = createDb(config);

migrate(db, { migrationsFolder: "drizzle" })
  .then(() => {
    logger.info("migrations applied");
    return pool.end();
  })
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "migration failed");
    void pool.end();
    process.exit(1);
  });
