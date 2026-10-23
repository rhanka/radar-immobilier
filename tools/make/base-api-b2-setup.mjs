// Prepare only the disposable runner's shared synthetic source-schema DB.
import assert from 'node:assert/strict';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
assert.equal(process.cwd(), '/workspace/api');
assert.equal(process.env.LOT_MIGRATION_DB_TEST, '1');
const pool = new pg.Pool({ host: process.env.POSTGRES_HOST,
  user: 'radar', password: 'synthetic-only', database: 'radar' });
try {
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: 'drizzle' });
  await migrate(db, { migrationsFolder: 'drizzle' });
} finally { await pool.end(); }
