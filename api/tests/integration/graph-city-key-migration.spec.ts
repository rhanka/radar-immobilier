/**
 * GH #812 — migration 0013_graph_city_key on a database seeded at 0012.
 *
 * A scratch database is created, migrated up to 0012 (journal truncated in a temp
 * copy of the migrations folder), seeded with the shapes found in prod (NULL-city
 * nodes with edges to city nodes on one side only, edges without any existing
 * endpoint, cross-city edges, a drifted primary key name, geo rows), then migrated
 * to 0013. The scratch database is dropped afterwards.
 */
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config.js";

const MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));
const SCRATCH_DB = `radar_m0013_${process.pid}`;
const config = loadConfig();

function client(database: string): pg.Client {
  return new pg.Client({
    host: config.POSTGRES_HOST,
    port: config.POSTGRES_PORT,
    user: config.POSTGRES_USER,
    password: config.POSTGRES_PASSWORD,
    database,
  });
}

async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = client(config.POSTGRES_DB);
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function migrateFolder(folder: string, notices: string[] = []): Promise<void> {
  const pool = new pg.Pool({
    host: config.POSTGRES_HOST,
    port: config.POSTGRES_PORT,
    user: config.POSTGRES_USER,
    password: config.POSTGRES_PASSWORD,
    database: SCRATCH_DB,
    max: 1,
  });
  pool.on("connect", (c) => c.on("notice", (n) => notices.push(n.message ?? "")));
  try {
    await migrate(drizzle(pool), { migrationsFolder: folder });
  } finally {
    await pool.end();
  }
}

let upTo0012: string;
let db: pg.Client;

beforeAll(async () => {
  await admin(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
    await c.query(`CREATE DATABASE ${SCRATCH_DB}`);
  });
  upTo0012 = await mkdtemp(join(tmpdir(), "m0013-"));
  await cp(MIGRATIONS, upTo0012, { recursive: true });
  const journalPath = join(upTo0012, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as { entries: Array<{ tag: string }> };
  journal.entries = journal.entries.filter((entry) => entry.tag !== "0013_graph_city_key");
  await writeFile(journalPath, JSON.stringify(journal));
  await migrateFolder(upTo0012);

  db = client(SCRATCH_DB);
  await db.connect();
  // Prod drift: the PK has another name than graph_nodes_pkey.
  await db.query(`ALTER TABLE graph_nodes RENAME CONSTRAINT graph_nodes_pkey TO graph_nodes_drifted_pk`);
  await db.query(`
    INSERT INTO graph_nodes (id, type, label, city_slug) VALUES
      ('bylaw-242', 'Bylaw', 'Règlement 242', 'gore'),
      ('zone-c-6', 'Zone', 'C-6', 'gore'),
      ('zone-b-1', 'Zone', 'B-1', 'barkmere'),
      ('global-1', 'Concept', 'global', NULL),
      ('global-2', 'Concept', 'global', NULL)`);
  await db.query(`
    INSERT INTO graph_edges (src_id, dst_id, kind) VALUES
      ('bylaw-242', 'zone-c-6', 'regulates'),
      ('zone-c-6', 'zone-b-1', 'touches'),
      ('ghost-a', 'bylaw-242', 'cites'),
      ('global-1', 'bylaw-242', 'about'),
      ('zone-b-1', 'global-2', 'about'),
      ('global-1', 'global-2', 'about'),
      ('ghost-a', 'ghost-b', 'cites')`);
  await db.query(`
    INSERT INTO geo_resolutions (node_id, node_type, city_slug, relation_type, target_id, target_type, score_confiance, provenance)
    VALUES ('bylaw-242', 'Signal', 'gore', 'concerns_lot', 'lot-1', 'Lot', 0.9, 'lot_explicit')`);
}, 120_000);

afterAll(async () => {
  await db?.end();
  await admin((c) => c.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`));
  if (upTo0012) await rm(upTo0012, { recursive: true, force: true });
});

describe("migration 0013_graph_city_key", () => {
  const notices: string[] = [];

  it("fails fast on a held lock (lock_timeout) and leaves the schema at 0012", async () => {
    const holder = client(SCRATCH_DB);
    await holder.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT count(*) FROM graph_nodes"); // ACCESS SHARE until COMMIT
      const error = await migrateFolder(MIGRATIONS).then(() => null, (err: unknown) => err as Error & { cause?: Error });
      expect(error).not.toBeNull();
      // drizzle wraps the driver error ("Failed query: …"); the cause is the lock timeout.
      expect(`${error!.message} ${error!.cause?.message ?? ""}`).toMatch(/lock timeout/i);
    } finally {
      await holder.query("ROLLBACK");
      await holder.end();
    }
    const pk = await db.query(`SELECT conname FROM pg_constraint WHERE conrelid = 'graph_nodes'::regclass AND contype = 'p'`);
    expect(pk.rows[0].conname).toBe("graph_nodes_drifted_pk");
  }, 60_000);

  it("migrates: PK (city_slug, id), NULL-city rows and unplaced edges deleted, counts in NOTICE", async () => {
    await migrateFolder(MIGRATIONS, notices);

    const pk = await db.query(`
      SELECT c.conname, array_agg(a.attname::text ORDER BY array_position(c.conkey, a.attnum)) AS cols
        FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
       WHERE c.conrelid = 'graph_nodes'::regclass AND c.contype = 'p' GROUP BY c.conname`);
    expect(pk.rows[0].conname).toBe("graph_nodes_pkey");
    expect(pk.rows[0].cols).toEqual(["city_slug", "id"]);

    const nodes = await db.query(`SELECT city_slug, id FROM graph_nodes ORDER BY city_slug, id`);
    expect(nodes.rows).toEqual([
      { city_slug: "barkmere", id: "zone-b-1" },
      { city_slug: "gore", id: "bylaw-242" },
      { city_slug: "gore", id: "zone-c-6" },
    ]);

    const edges = await db.query(`SELECT city_slug, src_id, dst_id, kind FROM graph_edges ORDER BY src_id, dst_id`);
    expect(edges.rows).toEqual([
      { city_slug: "gore", src_id: "bylaw-242", dst_id: "zone-c-6", kind: "regulates" },
      // dst endpoint absent: placed at the city of the existing endpoint (reconciled by the projection)
      { city_slug: "gore", src_id: "ghost-a", dst_id: "bylaw-242", kind: "cites" },
      // cross-city edge: placed at the city of its src node
      { city_slug: "gore", src_id: "zone-c-6", dst_id: "zone-b-1", kind: "touches" },
    ]);

    const report = notices.find((n) => n.startsWith("graph-city-key: nodes"));
    expect(report).toContain("deleted NULL-city nodes: 2");
    expect(report).toContain("deleted edges incident to a NULL-city node: 3");
    expect(report).toContain("deleted edges without any existing endpoint: 1");

    const nullable = await db.query(`
      SELECT table_name, is_nullable FROM information_schema.columns
       WHERE column_name = 'city_slug' AND table_name IN ('graph_nodes', 'graph_edges') ORDER BY table_name`);
    expect(nullable.rows).toEqual([
      { table_name: "graph_edges", is_nullable: "NO" },
      { table_name: "graph_nodes", is_nullable: "NO" },
    ]);
  }, 60_000);

  it("allows the same id and the same edge triple in two cities afterwards", async () => {
    await db.query(`INSERT INTO graph_nodes (id, type, label, city_slug) VALUES ('bylaw-242', 'Bylaw', 'Règlement 242', 'barkmere')`);
    await db.query(`INSERT INTO graph_edges (city_slug, src_id, dst_id, kind) VALUES ('barkmere', 'bylaw-242', 'zone-c-6', 'regulates')`);
    await expect(
      db.query(`INSERT INTO graph_edges (city_slug, src_id, dst_id, kind) VALUES ('barkmere', 'bylaw-242', 'zone-c-6', 'regulates')`),
    ).rejects.toThrow(/graph_edges_city_natural_key_idx/);
    await db.query(`
      INSERT INTO geo_resolutions (node_id, node_type, city_slug, relation_type, target_id, target_type, score_confiance, provenance)
      VALUES ('bylaw-242', 'Signal', 'barkmere', 'concerns_lot', 'lot-1', 'Lot', 0.9, 'lot_explicit')`);
    const geo = await db.query(`SELECT city_slug FROM geo_resolutions WHERE node_id = 'bylaw-242' ORDER BY city_slug`);
    expect(geo.rows.map((r) => r.city_slug)).toEqual(["barkmere", "gore"]);
  });

  it("is idempotent: replaying the 0013 statements changes nothing", async () => {
    const before = await db.query(`SELECT count(*)::int AS n FROM graph_edges`);
    const sql = await readFile(join(MIGRATIONS, "0013_graph_city_key.sql"), "utf8");
    const replayNotices: string[] = [];
    const onNotice = (n: { message?: string }) => replayNotices.push(n.message ?? "");
    db.on("notice", onNotice);
    try {
      await db.query("BEGIN");
      for (const statement of sql.split("--> statement-breakpoint")) await db.query(statement);
      await db.query("COMMIT");
    } finally {
      db.off("notice", onNotice);
    }
    expect(replayNotices.some((n) => n.includes("already (city_slug, id)"))).toBe(true);
    const after = await db.query(`SELECT count(*)::int AS n FROM graph_edges`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
