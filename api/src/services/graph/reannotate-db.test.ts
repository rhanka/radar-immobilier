import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { database, describeDb } from "../facets/scope-db-fixture.js";
import { withReannotationDb } from "./reannotate-db.js";
import { createReannotationRepository } from "./reannotate-repository.js";

describeDb("bounded classification PostgreSQL sessions", () => {
  it("should install server timeouts and cancel a blocked evidence read", async () => {
    const { db, pool } = await database();
    const settings = await withReannotationDb(db, undefined, (bounded) => bounded.execute(sql`SELECT
      current_setting('statement_timeout') AS statement, current_setting('lock_timeout') AS lock`));
    expect(settings.rows).toEqual([{ statement: "5s", lock: "1s" }]);
    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("LOCK TABLE graph_nodes IN ACCESS EXCLUSIVE MODE");
      await expect(createReannotationRepository(db).list(new Date(0), AbortSignal.timeout(30)))
        .rejects.toThrow();
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
    expect(await createReannotationRepository(db).list(new Date(0))).toEqual([]);
  });
  it("should time out the human-history lock and never write after cancellation", async () => {
    const { db, pool } = await database();
    const blocker = await pool.connect();
    const input = { citySlug: "city", nodeId: "act", nodeType: "Signal", source: "ai" as const,
      classe: "pertinent" as const, reason: "Residential", ambiguous: false, model: "model", effort: "low",
      promptId: "v2", promptSha256: "a".repeat(64), inputSha256: "b".repeat(64), pipelineRunId: "run" };
    try {
      await blocker.query("BEGIN");
      await blocker.query("LOCK TABLE facet_events IN ROW EXCLUSIVE MODE");
      // No application abort: PostgreSQL itself must bound this wait.
      await expect(createReannotationRepository(db).write(input)).rejects.toThrow();
      await expect(createReannotationRepository(db).write(input, AbortSignal.timeout(30))).rejects.toThrow();
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
    expect((await db.execute(sql`SELECT * FROM signal_class_annotations`)).rows).toEqual([]);
    expect(await createReannotationRepository(db).write(input)).toBe("written");
  });
});
