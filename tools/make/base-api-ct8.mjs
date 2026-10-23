// Standalone CT-8: fresh install, baseline upgrade, data retention and rerun.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
const entries = journal.entries;
// Preserve the inherited 9a815087 prefix, including its older timestamps.
const baselineCount = 21;
assert.equal(entries[baselineCount - 1].tag, '0021_facet_lot_history');
const expected = entries.map(e => ({
  hash: createHash('sha256').update(readFileSync(`drizzle/${e.tag}.sql`)).digest('hex'),
  created_at: String(e.when),
}));
assert.equal(new Set(expected.map(e => e.hash)).size, entries.length);
assert.equal(new Set(entries.map(e => e.tag)).size, entries.length);
entries.forEach((e, i) => {
  assert.equal(e.idx, i);
  if (i >= baselineCount) assert.ok(e.when > Math.max(...entries.slice(0, i).map(e => e.when)));
});
const admin = new pg.Pool({ host: 'postgres', user: 'radar', password: 'synthetic-only', database: 'radar' });
try {
  for (const profile of ['fresh', 'upgrade']) {
    const name = `synthetic_ct8_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE DATABASE "${name}"`);
    const pool = new pg.Pool({ host: 'postgres', user: 'radar', password: 'synthetic-only', database: name });
    const db = drizzle(pool);
    const folder = `tmp/${name}`;
    try {
      if (profile === 'upgrade') {
        mkdirSync(`${folder}/meta`, { recursive: true });
        const prefix = entries.slice(0, baselineCount);
        for (const e of prefix) copyFileSync(`drizzle/${e.tag}.sql`, `${folder}/${e.tag}.sql`);
        writeFileSync(`${folder}/meta/_journal.json`, JSON.stringify({ ...journal, entries: prefix }));
        await migrate(db, { migrationsFolder: folder });
        await pool.query('CREATE TABLE synthetic_ct8_probe(id integer PRIMARY KEY, value text)');
        await pool.query("INSERT INTO synthetic_ct8_probe VALUES (1, 'retained')");
      }
      await migrate(db, { migrationsFolder: 'drizzle' });
      const history = async () => (await pool.query(
        'SELECT hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY id')).rows;
      assert.deepEqual(await history(), expected);
      await migrate(db, { migrationsFolder: 'drizzle' });
      assert.deepEqual(await history(), expected);
      if (profile === 'upgrade') assert.deepEqual((await pool.query('SELECT * FROM synthetic_ct8_probe')).rows,
        [{ id: 1, value: 'retained' }]);
      console.log(`CT8 PASS ${profile} + rerun: ${entries.length} hashes exactly once`);
    } finally {
      await pool.end();
      await admin.query(`DROP DATABASE "${name}"`);
      rmSync(folder, { recursive: true, force: true });
    }
  }
} finally { await admin.end(); }
