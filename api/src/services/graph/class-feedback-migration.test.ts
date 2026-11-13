import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { expect, it } from "vitest";
import { database, describeDb } from "../facets/scope-db-fixture.js";

describeDb("feedback migration ordering", () => {
  it("should apply 0047 once after the preceding migrations and retain existing annotations", async () => {
    const { db, pool } = await database(true);
    mkdirSync("tmp", { recursive: true });
    const folder = mkdtempSync("tmp/feedback-migrations-");
    try {
      mkdirSync(`${folder}/meta`);
      const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
      const feedback = journal.entries.at(-1);
      expect(feedback).toMatchObject({ idx: 46, tag: "0047_signal_class_feedback", when: 1793000000017 });
      const preceding = { ...journal, entries: journal.entries.slice(0, -1) };
      expect(preceding.entries.every((entry: { idx: number; when: number }) =>
        entry.idx < feedback.idx && entry.when < feedback.when)).toBe(true);
      writeFileSync(`${folder}/meta/_journal.json`, JSON.stringify(preceding));
      for (const entry of preceding.entries) copyFileSync(`drizzle/${entry.tag}.sql`, `${folder}/${entry.tag}.sql`);
      await migrate(db, { migrationsFolder: folder });
      await pool.query(`INSERT INTO signal_class_annotations
        (city_slug,node_type,node_id,classe,reason,source,model,effort,prompt_id,prompt_sha256,pipeline_run_id,input_sha256)
        VALUES ('synthetic-city','Signal','migration-signal','pertinent','Existing annotation','ai',
          'synthetic-model','low','p0-v1',repeat('a',64),'synthetic-run',repeat('b',64))`);
      await migrate(db, { migrationsFolder: "drizzle" });
      await migrate(db, { migrationsFolder: "drizzle" });
      expect((await pool.query(`SELECT judged_class FROM signal_class_feedback`)).rows).toEqual([]);
      expect((await pool.query(`SELECT node_id,classe FROM signal_class_annotation_history`)).rows)
        .toEqual([{ node_id: "migration-signal", classe: "pertinent" }]);
      expect((await pool.query(`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations WHERE created_at=$1`,
        [feedback.when])).rows).toEqual([{ count: 1 }]);
      // On the temporary v2 merge, prove that its 0046 actually ran first.
      if (preceding.entries.at(-1).tag === "0046_signal_class_ambiguity") {
        expect((await pool.query(`SELECT ambiguous FROM signal_class_annotations`)).rows).toEqual([{ ambiguous: false }]);
        expect((await pool.query(`SELECT created_at::text FROM drizzle.__drizzle_migrations
          ORDER BY created_at DESC LIMIT 2`)).rows)
          .toEqual([{ created_at: "1793000000017" }, { created_at: "1793000000016" }]);
      }
    } finally { rmSync(folder, { recursive: true }); }
  });
  it("should install the feedback schema on a fresh database", async () => {
    const { pool } = await database();
    expect((await pool.query(`SELECT to_regclass('signal_class_feedback')::text AS name`)).rows)
      .toEqual([{ name: "signal_class_feedback" }]);
  });
});
