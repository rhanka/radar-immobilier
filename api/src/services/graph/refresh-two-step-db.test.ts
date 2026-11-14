import { expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { database, describeDb, event, fixture } from "../facets/scope-db-fixture.js";
import { readClassAnnotations } from "./class-annotations.js";
import { createReannotationRepository } from "./reannotate-repository.js";
import { reannotationInputSha256, runReannotation } from "./reannotate-signals.js";
import { twoStepFixture } from "./refresh-two-step.fixture.js";
import * as graphStore from "./graph-store.js";
import { RefreshRunBudget } from "./refresh-run-budget.js";

describeDb("two-step refresh with PostgreSQL", () => {
  it("should cover the document while bounding classification separately from detection", async () => {
    const { db } = await database();
    const budget = new RefreshRunBudget({ calls: 1, tokens: 1_000_000, durationMs: 60_000 });
    const f = await twoStepFixture(db, "two-step", false, budget);
    expect(await f.run()).toMatchObject({ status: "published", coverage: { covered: 1 } });
    expect(f.detectionRequests).toHaveLength(2);
    expect(f.classificationRequests).toHaveLength(1);
    expect(budget).toMatchObject({ calls: 1, haltedBy: "calls" });
    expect((await readClassAnnotations(db, "waterloo")).size).toBe(1);
    expect(f.notes.find(({ note }) => note === "classification-completed")?.detail)
      .toMatchObject({ written: 1, haltedBy: "calls" });
  });

  it.each(["missing", "v1", "v2"])("should not classify an existing unchanged act with %s annotation", async (annotation) => {
    const { db } = await database();
    const first = await twoStepFixture(db, "two-step");
    await first.run();
    if (annotation === "missing") await db.execute(sql`DELETE FROM signal_class_annotations`);
    if (annotation === "v1") await db.execute(sql`UPDATE signal_class_annotations SET prompt_id='p0-v1'`);
    const second = await twoStepFixture(db, "two-step", false, undefined, " next document");
    second.store.seed("graph/waterloo/latest.json", await first.store.get("graph/waterloo/latest.json"));
    await second.run();
    expect(second.detectionRequests).toHaveLength(2);
    expect(second.classificationRequests).toHaveLength(0);
    expect(second.notes.find(({ note }) => note === "classification-completed")?.detail)
      .toMatchObject({ candidates: 0, written: 0 });
    expect((await db.execute(sql`SELECT DISTINCT prompt_id FROM signal_class_annotations`)).rows)
      .toEqual(annotation === "missing" ? [] : [{ prompt_id: annotation === "v1" ? "p0-v1" : "v2" }]);
  });

  it("should classify after resuming a published document without another detection call", async () => {
    const { db } = await database();
    const f = await twoStepFixture(db, "two-step");
    const project = vi.spyOn(graphStore, "upsertGraphAtomic").mockRejectedValueOnce(new Error("projection interrupted"));
    try {
      await expect(f.run()).rejects.toThrow();
      expect(f.classificationRequests).toHaveLength(0);
      expect(await f.run()).toMatchObject({ status: "published" });
      expect(f.detectionRequests).toHaveLength(2);
      expect(f.classificationRequests).toHaveLength(2);
      expect((await readClassAnnotations(db, "waterloo")).size).toBe(2);
    } finally { project.mockRestore(); }
  });

  it("should keep off and two-step detection byte-identical while adding only v2 annotations", async () => {
    const offDb = await database();
    const twoDb = await database();
    const off = await twoStepFixture(offDb.db, "off");
    const two = await twoStepFixture(twoDb.db, "two-step");
    expect(await off.run()).toMatchObject({ status: "published" });
    expect(await two.run()).toMatchObject({ status: "published" });
    expect(two.detectionRequests).toEqual(off.detectionRequests);
    expect(two.detectionRequests.map(({ model }) => [model.model, model.effort]))
      .toEqual([["gpt-6-astra", "medium"], ["gemini-3.8-flash", "low"]]);
    expect(off.classificationRequests).toHaveLength(0);
    expect(two.classificationRequests).toHaveLength(2);
    expect([...two.store.objects.keys()].sort()).toEqual([...off.store.objects.keys()].sort());
    for (const [key, value] of off.store.objects) {
      // Runtime receipt latencies can differ; compare every persisted extraction/graph byte.
      if (key.endsWith("/state.json")) continue;
      expect(new TextDecoder().decode(await two.store.get(key)), key).toBe(new TextDecoder().decode(value.body));
    }
    const query = sql`SELECT id,type,label,props,source_ref FROM graph_nodes ORDER BY id`;
    expect((await twoDb.db.execute(query)).rows).toEqual((await offDb.db.execute(query)).rows);
    expect((await readClassAnnotations(offDb.db, "waterloo")).size).toBe(0);
    const annotations = await readClassAnnotations(twoDb.db, "waterloo");
    expect([...annotations.keys()].sort()).toEqual(["DesignationEvent:new-DesignationEvent", "Signal:new-Signal"]);
    const repo = createReannotationRepository(twoDb.db);
    for (const signal of await repo.list(new Date(0))) {
      if (signal.id === "baseline-only") continue;
      expect(annotations.get(`${signal.type}:${signal.id}`)).toMatchObject({ source: "ai",
        classe: "a_surveiller", ambiguous: true, promptId: "v2", promptSha256: two.prompt.sha256,
        model: "gpt-6-astra", effort: "low", pipelineRunId: two.options.cycleId,
        inputSha256: reannotationInputSha256(signal) });
    }
    expect(two.notes.find(({ note }) => note === "classification-completed")?.detail)
      .toMatchObject({ candidates: 2, written: 2, failed: 0 });
  });

  it("should publish and cover detection when both classification models fail", async () => {
    const { db } = await database();
    const f = await twoStepFixture(db, "two-step", true);
    expect(await f.run()).toMatchObject({ status: "published", coverage: { covered: 1 } });
    expect(f.notes.find(({ note }) => note === "classification-completed")?.detail)
      .toMatchObject({ candidates: 2, written: 0, failed: 2 });
    expect((await readClassAnnotations(db, "waterloo")).size).toBe(0);
    expect((await db.execute(sql`SELECT count(*)::int AS count FROM graph_nodes WHERE id LIKE 'new-%'`)).rows)
      .toEqual([{ count: 2 }]);
    expect(await f.run()).toMatchObject({ status: "up-to-date" });
    expect(f.detectionRequests).toHaveLength(2);
  });

  it("should preserve a manual thumbs-up and avoid sending that act to classification", async () => {
    const human = await fixture();
    const approval = await event(human, { citySlug: "waterloo", nodeId: "new-Signal", state: "active" });
    const f = await twoStepFixture(human.db, "two-step");
    expect(await f.run()).toMatchObject({ status: "published" });
    expect(f.classificationRequests).toHaveLength(1);
    expect(f.notes.find(({ note }) => note === "classification-completed")?.detail)
      .toMatchObject({ skippedManual: 1, written: 1 });
    const rows = await human.db.execute(sql`SELECT id FROM facet_events WHERE city_slug='waterloo'`);
    expect(rows.rows).toEqual([{ id: approval.id }]);
    expect((await createReannotationRepository(human.db).annotation({ citySlug: "waterloo", id: "new-Signal",
      type: "Signal", label: "Act", props: {}, sourceRef: null }))?.source).toBe("manual");
    expect((await human.db.execute(sql`SELECT node_id FROM signal_class_annotations`)).rows)
      .toEqual([{ node_id: "new-DesignationEvent" }]);
  });

  it("should reuse the 30-day path and classify changed input without touching unchanged acts", async () => {
    const { db } = await database();
    const f = await twoStepFixture(db, "two-step");
    await f.run();
    const classification = f.options.classification!;
    const run = () => runReannotation({ ...classification, repository: createReannotationRepository(db),
      apply: true, changedInputOnly: true, now: f.options.now!(), pipelineRunId: "second-run",
      classify: async () => ({ classe: "pertinent", reason: "Changed residential evidence", ambiguous: false,
        model: classification.primary.model, effort: classification.primary.effort }) });
    // Scope to this document: the old baseline act is outside automatic two-step selection.
    await db.execute(sql`DELETE FROM graph_nodes WHERE id='baseline-only'`);
    expect(await run()).toMatchObject({ skippedUnchanged: 2, classified: 0 });
    await db.execute(sql`UPDATE graph_nodes SET label='Changed act evidence' WHERE id='new-Signal'`);
    expect(await run()).toMatchObject({ skippedUnchanged: 1, classified: 1, written: 1 });
    expect((await readClassAnnotations(db, "waterloo")).get("Signal:new-Signal"))
      .toMatchObject({ classe: "pertinent", pipelineRunId: "second-run" });
  });
});
