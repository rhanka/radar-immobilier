/**
 * GH #812 — run-geo-mapper RESET=1 (review SOL-825-03): every requested city is purged of its
 * geo_resolutions and geo_unresolved rows, even a city without current geometry, and nothing
 * else is touched. The script is run as the Job runs it (DATABASE_URL, CITIES, RESET).
 */
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config.js";
import { createDb, type Database } from "../../src/db/client.js";
import { geoResolutions, geoUnresolved } from "../../src/db/schema.js";

const run = promisify(execFile);
const API = fileURLToPath(new URL("../..", import.meta.url));
const P = "__812geo_";
const config = loadConfig();
let db: Database;
let pool: ReturnType<typeof createDb>["pool"];

beforeAll(() => {
  ({ db, pool } = createDb(config));
});
afterAll(async () => {
  await clean();
  await pool.end();
});

async function clean(): Promise<void> {
  await db.delete(geoResolutions).where(like(geoResolutions.citySlug, `${P}%`));
  await db.delete(geoUnresolved).where(like(geoUnresolved.citySlug, `${P}%`));
}

async function seed(city: string): Promise<void> {
  await db.insert(geoResolutions).values({ nodeId: "sig-1", nodeType: "Signal", citySlug: city, relationType: "concerns_lot",
    targetId: "lot-1", targetType: "Lot", scoreConfiance: "0.9", provenance: "lot_explicit" });
  await db.insert(geoUnresolved).values({ nodeId: "sig-2", nodeType: "Signal", citySlug: city, patternType: "no_lot", raison: "no_polygon" });
}

function mapper(env: Record<string, string>) {
  const url = `postgres://${config.POSTGRES_USER}:${config.POSTGRES_PASSWORD}@${config.POSTGRES_HOST}:${config.POSTGRES_PORT}/${config.POSTGRES_DB}`;
  return run("npx", ["tsx", "src/services/geo/run-geo-mapper.ts"], { cwd: API, env: { ...process.env, DATABASE_URL: url, ...env } });
}

async function counts(city: string) {
  const res = await db.select().from(geoResolutions).where(like(geoResolutions.citySlug, city));
  const unres = await db.select().from(geoUnresolved).where(like(geoUnresolved.citySlug, city));
  return { res: res.length, unres: unres.length };
}

describe("run-geo-mapper RESET=1", () => {
  it("purges a requested city without current geometry and leaves the other cities alone", async () => {
    await clean();
    const target = `${P}no-geo`;
    const other = `${P}other`;
    await seed(target);
    await seed(other);
    const { stdout } = await mapper({ RESET: "1", CITIES: target });
    expect(stdout).toContain("MODE RESET");
    expect(await counts(target)).toEqual({ res: 0, unres: 0 });
    expect(await counts(other)).toEqual({ res: 1, unres: 1 });
  }, 60_000);

  it("refuses RESET without CITIES (exit 2, nothing purged)", async () => {
    await clean();
    await seed(`${P}kept`);
    await expect(mapper({ RESET: "1", CITIES: "" })).rejects.toMatchObject({ code: 2 });
    expect(await counts(`${P}kept`)).toEqual({ res: 1, unres: 1 });
  }, 60_000);
});
