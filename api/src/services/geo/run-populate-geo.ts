/**
 * Runner : peuple/rafraîchit les polygones géo radar depuis @sentropic/geo.
 *
 * Lit les manifestes CKAN zones + (optionnel) les lots cadastre bornés,
 * upsert dans zone_versions / lot_versions, puis lance la résolution géo
 * Signal/DesignationEvent → zone/lot.
 *
 * Usage local :
 *   DATABASE_URL="postgres://..." npx tsx src/services/geo/run-populate-geo.ts
 *
 * Options via env :
 *   CITIES="longueuil,gatineau"      — restreindre les villes zones (défaut: tous les manifestes CKAN)
 *   POPULATE_LOTS="0"               — désactiver les lots (défaut: activé)
 *   LOT_CITIES="longueuil,saguenay" — villes lots bornées (défaut service)
 *   RUN_RESOLUTION="0"              — ne pas résoudre après pull (défaut: activé)
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../../db/schema.js";
import { populateGeo } from "./populate-geo.js";

const DATABASE_URL =
  process.env["DATABASE_URL"] ??
  "postgres://radar:219c0ff1da554bfd05e410b35f32a114319599423f6a96d8@127.0.0.1:5434/radar";

function csvEnv(name: string): string[] | undefined {
  const value = process.env[name];
  if (!value || value.trim() === "") return undefined;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const citySlugs = csvEnv("CITIES");
const lotCitySlugs = csvEnv("LOT_CITIES");
const populateLots = process.env["POPULATE_LOTS"] !== "0";
const runResolution = process.env["RUN_RESOLUTION"] !== "0";

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema });

const logger = {
  info: (msgOrObj: string | object, ...args: unknown[]) => log("info", msgOrObj, args),
  warn: (msgOrObj: string | object, ...args: unknown[]) => log("warn", msgOrObj, args),
  error: (msgOrObj: string | object, ...args: unknown[]) => log("error", msgOrObj, args),
};

function log(level: "info" | "warn" | "error", msgOrObj: string | object, args: unknown[]) {
  const record = typeof msgOrObj === "string"
    ? { level, msg: msgOrObj, args }
    : { level, ...msgOrObj, args };
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

async function main() {
  console.log("=== Runner populate-geo ===");
  console.log(
    JSON.stringify({
      citySlugs: citySlugs ?? "ALL",
      populateLots,
      lotCitySlugs: lotCitySlugs ?? "DEFAULT",
      runResolution,
    }),
  );

  const options = {
    populateLots,
    runResolution,
    logger,
    ...(citySlugs ? { citySlugs } : {}),
    ...(lotCitySlugs ? { lotCitySlugs } : {}),
  };

  const result = await populateGeo(db, options);

  console.log("=== populate-geo result ===");
  console.log(JSON.stringify(result, null, 2));

  if (result.citiesErrored > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("populate-geo failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
