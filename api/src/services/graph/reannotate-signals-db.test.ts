import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { graphNodes } from "../../db/schema.js";
import { database, describeDb } from "../facets/scope-db-fixture.js";
import { createReannotationRepository } from "./reannotate-repository.js";
import { runReannotation } from "./reannotate-signals.js";

describeDb("PostgreSQL recent signal reannotation", () => {
  it("writes nothing in dry-run, applies once, and resumes without duplicate calls", async () => {
    const { db } = await database();
    const citySlug = `synthetic-reannotation-${randomUUID()}`;
    const now = new Date("2026-11-13T12:00:00.000Z");
    for (const [id, createdAt] of [["recent", now], ["manual", now], ["old", new Date("2026-10-01")]] as const) {
      await db.insert(graphNodes).values({ citySlug, id, type: "Signal", label: id,
        props: { refs: [{ excerpt: "Residential project approved" }] }, createdAt });
    }
    await db.execute(sql`INSERT INTO signal_class_annotations (city_slug,node_type,node_id,classe,reason,source)
      VALUES (${citySlug},'Signal','manual','ecarte','Human decision','manual')`);
    const classify = vi.fn(async () => ({ classe: "pertinent" as const, reason: "Housing", ambiguous: true,
      model: "gpt-6-astra", effort: "medium" }));
    const options = { repository: createReannotationRepository(db), classify, now,
      primary: { provider: "openai" as const, model: "gpt-6-astra", effort: "medium" },
      fallback: { provider: "gemini" as const, model: "gemini-3.8-flash", effort: "low" },
      prompt: { id: "p0-v1", sha256: "a".repeat(64), text: "instructions" }, pipelineRunId: randomUUID() };
    expect(await runReannotation(options)).toMatchObject({ candidates: 2, classified: 1, written: 0, skippedManual: 1 });
    expect((await db.execute(sql`SELECT 1 FROM signal_class_annotations WHERE source='ai'`)).rows).toHaveLength(0);
    expect(await runReannotation({ ...options, apply: true })).toMatchObject({ written: 1 });
    const stored = await db.execute(sql`SELECT * FROM signal_class_annotations WHERE source='ai'`);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]).toMatchObject({ source: "ai", ambiguous: true, model: "gpt-6-astra", effort: "medium",
      prompt_id: "p0-v1", prompt_sha256: "a".repeat(64), pipeline_run_id: options.pipelineRunId });
    expect(await runReannotation({ ...options, repository: createReannotationRepository(db), apply: true }))
      .toMatchObject({ skippedUnchanged: 1, skippedManual: 1, written: 0, classified: 0 });
    expect((await db.execute(sql`SELECT classe,reason FROM signal_class_annotations WHERE source='manual'`)).rows)
      .toEqual([{ classe: "ecarte", reason: "Human decision" }]);
    expect(classify).toHaveBeenCalledTimes(2);
  });
});
