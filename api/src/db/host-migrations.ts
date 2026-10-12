import type pg from "pg";
import { loadMigrationAssets } from "./migration-assets.js";

export const HOST_MIGRATION_LOCK = "radar-annotations-migration-cutover";

/** Single host authority, full predecessor/hash checks, one transaction per DDL step. */
export async function runHostMigrations(pool: pg.Pool, folder: string): Promise<void> {
  const assets = await loadMigrationAssets(folder);
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [HOST_MIGRATION_LOCK]);
    locked = true;
    const catalog = await client.query<{ table_name: string | null }>(
      "SELECT to_regclass('drizzle.__drizzle_migrations')::text AS table_name",
    );
    const applied = catalog.rows[0]?.table_name
      ? (await client.query<{ hash: string; created_at: string }>(
        "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id",
      )).rows : [];
    const appliedByWhen = new Map(applied.map((r) => [Number(r.created_at), r.hash]));
    if (appliedByWhen.size !== applied.length || applied.some((r) =>
      !assets.some((a) => a.when === Number(r.created_at) && a.checksum === r.hash))) {
      throw new Error("Migration receipt checksum or identity drift; refusing mutations");
    }
    let missingPredecessor = false;
    for (const asset of assets) {
      if (appliedByWhen.has(asset.when)) {
        if (missingPredecessor) throw new Error("Unattested migration predecessor; refusing silent skip");
      } else if (asset.tag !== "0009_account_invitations") missingPredecessor = true;
    }
    const invitations = await client.query<{ table_name: string | null }>(
      "SELECT to_regclass('public.account_invitations')::text AS table_name",
    );
    const migration0009 = assets.find((a) => a.tag === "0009_account_invitations")!;
    if (invitations.rows[0]?.table_name && !appliedByWhen.has(migration0009.when)) {
      throw new Error("0009 schema lacks a qualified receipt; explicit catalog attestation is required");
    }
    if (!invitations.rows[0]?.table_name && appliedByWhen.has(migration0009.when)) {
      throw new Error("0009 receipt has no schema; refusing drift");
    }
    await client.query("BEGIN");
    try {
      await client.query("CREATE SCHEMA IF NOT EXISTS drizzle");
      await client.query(`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations
        (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)`);
      await client.query(`CREATE TABLE IF NOT EXISTS drizzle.radar_migration_steps
        (tag text PRIMARY KEY, checksum text NOT NULL, predecessor_checksum text,
         applied_at timestamptz NOT NULL DEFAULT now())`);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    const extension = await client.query<{ tag: string; checksum: string; predecessor_checksum: string | null }>(
      "SELECT tag, checksum, predecessor_checksum FROM drizzle.radar_migration_steps",
    );
    for (const row of extension.rows) {
      const index = assets.findIndex((a) => a.tag === row.tag);
      if (index < 0 || assets[index]!.checksum !== row.checksum ||
          (assets[index - 1]?.checksum ?? null) !== row.predecessor_checksum ||
          !appliedByWhen.has(assets[index]!.when)) {
        throw new Error("Host extension/native receipt drift");
      }
    }
    for (const [index, asset] of assets.entries()) {
      if (appliedByWhen.has(asset.when) && extension.rows.some((r) => r.tag === asset.tag)) continue;
      await client.query("BEGIN");
      try {
        if (!appliedByWhen.has(asset.when)) {
          for (const statement of asset.statements) await client.query(statement);
          await client.query("INSERT INTO drizzle.__drizzle_migrations(hash, created_at) VALUES ($1, $2)",
            [asset.checksum, asset.when]);
        }
        await client.query(`INSERT INTO drizzle.radar_migration_steps(tag, checksum, predecessor_checksum)
          VALUES ($1, $2, $3)`, [asset.tag, asset.checksum, assets[index - 1]?.checksum ?? null]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
    }
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext($1))", [HOST_MIGRATION_LOCK]);
    client.release();
  }
}
