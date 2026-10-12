import { writeFile } from "node:fs/promises";

import { runHostMigrations } from "./host-migrations.js";
import { createDb } from "./client.js";
import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const { pool } = createDb(config);

// Hand-authored migrations report their counts with RAISE NOTICE (e.g. 0013: deleted
// NULL-city nodes and unplaced edges, GH #812). Every NOTICE is logged, and a bounded summary
// (committed vs failed + the notices) goes to the termination message, which the CD prints
// without needing pods/log. Each DDL step commits separately; a failed step rolls back
// while earlier steps remain committed. Legacy retirement is an explicit cutover operation.
const TERMINATION_LOG = "/dev/termination-log";
const notices: string[] = [];
pool.on("connect", (client) => {
  client.on("notice", (notice) => {
    const message = notice.message ?? "";
    notices.push(message);
    logger.info({ notice: message }, "migration notice");
  });
});

async function writeSummary(summary: Record<string, unknown>): Promise<void> {
  const relevant = notices.filter((n) => !/already exists, skipping$/.test(n));
  const body = JSON.stringify({ ...summary, notices: relevant }).slice(0, 4000);
  await writeFile(TERMINATION_LOG, body).catch(() => undefined);
}

runHostMigrations(pool, "drizzle")
  .then(async () => {
    logger.info("migrations applied");
    await writeSummary({ status: "committed" });
    return pool.end();
  })
  .then(() => process.exit(0))
  .catch(async (err) => {
    logger.error({ err }, "migration failed");
    const cause = (err as { cause?: { message?: string } }).cause?.message;
    await writeSummary({ status: "failed-current-step-rolled-back", error: String((err as Error).message ?? err).slice(0, 300), cause });
    void pool.end();
    process.exit(1);
  });
