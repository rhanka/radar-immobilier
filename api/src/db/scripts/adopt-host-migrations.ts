import { loadConfig } from "../../config.js";
import { createDb } from "../client.js";
import { runHostMigrations } from "../host-migrations.js";

const attestationRef = process.argv.find((arg) => arg.startsWith("--attestation-ref="))?.slice(18);
if (!attestationRef?.trim()) throw new Error("Pass --attestation-ref=<authorized-operation-reference>");
const { pool } = createDb(loadConfig());
try {
  await runHostMigrations(pool, "drizzle", { attestationRef });
  console.log(JSON.stringify({ status: "adopted", attestationRef }));
} finally { await pool.end(); }
