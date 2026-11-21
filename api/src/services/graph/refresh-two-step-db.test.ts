import { expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { database, describeDb, event, fixture } from "../facets/scope-db-fixture.js";
import { readClassAnnotations, writeClassAnnotation } from "./class-annotations.js";
import { createReannotationRepository } from "./reannotate-repository.js";
import { reannotationInputSha256, runReannotation } from "./reannotate-signals.js";
import { twoStepFixture } from "./refresh-two-step.fixture.js";
import * as graphStore from "./graph-store.js";
import { RefreshRunBudget } from "./refresh-run-budget.js";
import { randomUUID } from "node:crypto";
import { graphNodes } from "../../db/schema.js";
import { workspaceFixture } from "../facets/workspace-archive-fixture.js";
import { targetFingerprint } from "../facets/target.js";
import { writeClassFeedback } from "./class-feedback.js";

describeDb("two-step refresh with PostgreSQL", () => {
  it.each(["feedback", "manual"] as const)("should preserve %s through refresh and changed-input reannotation", async (kind) => {
    const human = await workspaceFixture();
    const target = { citySlug: "waterloo", type: "Signal" as const, id: "new-Signal" };
    const [node] = await human.db.insert(graphNodes).values({ citySlug: target.citySlug,
      id: target.id, type: target.type, label: "Previous act evidence" }).returning();
    await writeClassAnnotation(human.db, { citySlug: target.citySlug, nodeType: target.type, nodeId: target.id,
      source: "ai", classe: "pertinent", reason: "Previous residential evidence", model: "gpt-6-astra",
      effort: "low", promptId: "v2", promptSha256: "a".repeat(64), pipelineRunId: "before-human",
      inputSha256: reannotationInputSha256(node!) });
    const annotation = (await readClassAnnotations(human.db, target.citySlug, { includeDates: true })).get(`Signal:${target.id}`)!;
    if (kind === "feedback") {
      await writeClassFeedback(human.db, human.contributor.sub, human.workspaceId, {
        target, displayedFingerprint: targetFingerprint(node!), scope: "personal", verdict: "up",
        annotation: { source: "ai", model: annotation.model!, classe: annotation.classe,
          promptSha256: annotation.promptSha256!, pipelineRunId: annotation.pipelineRunId!, updatedAt: annotation.updatedAt! },
        selectionHeads: { pertinent: null, a_surveiller: null }, archives: { personal: null, workspace: null },
        commandKey: randomUUID(),
      });
    } else {
      await human.db.execute(sql`UPDATE signal_class_annotations SET source='manual', classe='pertinent',
        reason='Human decision' WHERE node_id=${target.id}`);
    }
    const before = await human.db.execute(sql`SELECT * FROM signal_class_annotations WHERE node_id=${target.id}`);
    const feedback = await human.db.execute(sql`SELECT * FROM signal_class_feedback`);
    const events = await human.db.execute(sql`SELECT * FROM facet_events ORDER BY id`);
    const second = await twoStepFixture(human.db, "two-step", false, undefined, " changed document");
    expect(await second.run()).toMatchObject({ status: "published" });
    expect(second.classificationRequests).toHaveLength(1);
    expect(second.notes.find(({ note }) => note === "classification-completed")?.detail)
      .toMatchObject({ candidates: 2, skippedManual: 1, written: 1 });
    const refreshed = (await createReannotationRepository(human.db).list(new Date(0)))
      .find((entry) => entry.id === target.id)!;
    expect(reannotationInputSha256(refreshed)).not.toBe(reannotationInputSha256(node!));
    await human.db.execute(sql`UPDATE graph_nodes SET label='Changed act evidence' WHERE id=${target.id}`);
    const classify = vi.fn();
    expect(await runReannotation({ ...second.options.classification!,
      repository: createReannotationRepository(human.db, { citySlug: target.citySlug, nodeIds: [target.id] }),
      now: second.options.now!(), pipelineRunId: "reannotation-after-human", apply: true, changedInputOnly: true, classify,
    })).toMatchObject({ candidates: 1, skippedManual: 1, classified: 0, written: 0 });
    expect(classify).not.toHaveBeenCalled();
    expect((await human.db.execute(sql`SELECT * FROM signal_class_annotations WHERE node_id=${target.id}`)).rows).toEqual(before.rows);
    expect((await human.db.execute(sql`SELECT * FROM signal_class_feedback`)).rows).toEqual(feedback.rows);
    expect((await human.db.execute(sql`SELECT * FROM facet_events ORDER BY id`)).rows).toEqual(events.rows);
  });

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

  it("should retry unclassified current-window signals on the next refresh pass after failure without re-running detection", async () => {
    const { db } = await database();
    let failKind: "quota" | "empty" | "timeout" | null = "quota";
    let failPrimary = false;
    const f = await twoStepFixture(db, "two-step");
    const recentDate = "2026-11-10";
    // Make the fixture document fall inside the current 31-day window of 2026-11-13.
    const metaKey = [...f.store.objects.keys()].find((k) => k.endsWith(".meta.json"))!;
    const meta = JSON.parse(new TextDecoder().decode(await f.store.get(metaKey))) as Record<string, unknown>;
    f.store.seed(metaKey, JSON.stringify({ ...meta, publishedAt: recentDate }));

    const modelCalls: string[] = [];
    const { createRefreshModelPolicy } = await import("./refresh-model-policy.js");
    const { runPvRefresh } = await import("./refresh-run.js");
    const run = () => {
      // Each CronJob pass instantiates a fresh model policy with the same REFRESH_CLASSIFY_* pair.
      const models = createRefreshModelPolicy({
        primary: f.options.classification!.primary,
        fallback: f.options.classification!.fallback,
        primaryQualityAttempts: 1, forceFallback: false, timeoutMs: 1000,
        createClient: (model) => ({ mode: "mesh", provider: model.provider, model: model.model,
          async generateJson(request) {
            modelCalls.push(`${model.provider}:${model.model}`);
            if (failKind === "quota") throw Object.assign(new Error("rate limit"), { status: 429 });
            if (failKind === "empty") {
              await request.validateResponse?.("");
              return { status: "completed", mode: "mesh", provider: model.provider, model: model.model, audit: {} };
            }
            if (failKind === "timeout") throw Object.assign(new Error("request timed out"), { name: "AbortError" });
            if (failPrimary && model.provider === f.options.classification!.primary.provider) {
              throw Object.assign(new Error("primary quota"), { status: 429 });
            }
            await request.validateResponse?.(JSON.stringify({ classe: "a_surveiller",
              reason: "Residential rezoning impact", reasonCode: "S-PORTEE-FLOUE", ambiguous: false }));
            return { status: "completed", mode: "mesh", provider: model.provider, model: model.model, audit: {} };
          } }),
      });
      return runPvRefresh({
        ...f.options,
        classification: { ...f.options.classification!, models },
      });
    };

    // Pass 1: document published & covered, but classification fails (quota).
    // Retry must NOT re-attempt the just-failed nodes in the same pass.
    expect(await run()).toMatchObject({ status: "published", coverage: { covered: 1 } });
    expect((await readClassAnnotations(db, "waterloo")).size).toBe(0);
    expect(f.notes.filter(({ note }) => note === "classification-retry-completed")).toHaveLength(0);

    // Pass 2 (empty response failure): city is up-to-date, detection does not re-run, signals remain unclassified.
    failKind = "empty";
    expect(await run()).toMatchObject({ status: "up-to-date" });
    expect(f.detectionRequests).toHaveLength(2);
    expect((await readClassAnnotations(db, "waterloo")).size).toBe(0);

    // Pass 3 (timeout failure): still unclassified.
    failKind = "timeout";
    expect(await run()).toMatchObject({ status: "up-to-date" });
    expect((await readClassAnnotations(db, "waterloo")).size).toBe(0);

    // Pass 4: primary fails with 429, configured fallback succeeds and writes both Signal & DesignationEvent.
    failKind = null;
    failPrimary = true;
    const beforeCalls = modelCalls.length;
    expect(await run()).toMatchObject({ status: "up-to-date" });
    expect(f.detectionRequests).toHaveLength(2);
    const annotations = await readClassAnnotations(db, "waterloo");
    expect([...annotations.keys()].sort()).toEqual(["DesignationEvent:new-DesignationEvent", "Signal:new-Signal"]);
    expect(annotations.get("Signal:new-Signal")).toMatchObject({
      source: "ai", classe: "a_surveiller", model: f.options.classification!.fallback.model,
    });
    expect(modelCalls.slice(beforeCalls)).toContain(
      `${f.options.classification!.fallback.provider}:${f.options.classification!.fallback.model}`,
    );
  });

  it("should enforce retryLimit newest-first per city and never overwrite manual or valid AI classes", async () => {
    const human = await fixture();
    const { db } = human;
    const f = await twoStepFixture(db, "two-step");
    // Prime coverage so the refresh pass takes the up-to-date path directly.
    await f.run();
    await db.execute(sql`DELETE FROM signal_class_annotations`);
    await db.execute(sql`DELETE FROM graph_nodes`);

    // Insert signals for waterloo (now = 2026-11-13, 31-day window >= 2026-10-13):
    // - 3 unclassified in window (including upcoming J+4 on 2026-11-17)
    // - 1 old unclassified outside window (2026-08-01)
    // - 1 manual in signal_class_annotations
    // - 1 manual in facet_events only
    // - 1 valid prior AI class (p0-v1, different inputSha256)
    // - 1 unclassified in another city
    await db.insert(graphNodes).values([
      { citySlug: "waterloo", id: "u-upcoming", type: "Signal", label: "Upcoming J+4", effectiveDocumentDates: ["2026-11-17"] },
      { citySlug: "waterloo", id: "u-recent", type: "DesignationEvent", label: "Recent", effectiveDocumentDates: ["2026-11-10"] },
      { citySlug: "waterloo", id: "u-older-in-window", type: "Signal", label: "Older in window", effectiveDocumentDates: ["2026-10-25"] },
      { citySlug: "waterloo", id: "u-outside-window", type: "Signal", label: "Old out of window", effectiveDocumentDates: ["2026-08-01"] },
      { citySlug: "waterloo", id: "keep-manual-row", type: "Signal", label: "Manual row", effectiveDocumentDates: ["2026-11-12"] },
      { citySlug: "waterloo", id: "keep-manual-event", type: "Signal", label: "Manual event", effectiveDocumentDates: ["2026-11-12"] },
      { citySlug: "waterloo", id: "keep-valid-ai", type: "Signal", label: "Valid v1 AI", effectiveDocumentDates: ["2026-11-12"] },
      { citySlug: "montreal", id: "other-city", type: "Signal", label: "Other city", effectiveDocumentDates: ["2026-11-12"] },
    ]);
    await db.execute(sql`INSERT INTO signal_class_annotations (city_slug,node_type,node_id,classe,reason,source)
      VALUES ('waterloo','Signal','keep-manual-row','ecarte','Human lock','manual')`);
    await event(human, { citySlug: "waterloo", nodeId: "keep-manual-event", state: "active" });
    await writeClassAnnotation(db, {
      citySlug: "waterloo", nodeType: "Signal", nodeId: "keep-valid-ai", source: "ai",
      classe: "pertinent", reason: "Prior valid AI class", model: "legacy-model", effort: "medium",
      promptId: "p0-v1", promptSha256: "b".repeat(64), pipelineRunId: "legacy-run", inputSha256: "c".repeat(64),
    });

    // Direct preserveExistingAi write must also refuse to overwrite a valid AI class.
    expect(await writeClassAnnotation(db, {
      citySlug: "waterloo", nodeType: "Signal", nodeId: "keep-valid-ai", source: "ai",
      classe: "ecarte", reason: "Must not overwrite", model: "gpt-6-astra", effort: "low",
      promptId: "v2", promptSha256: "d".repeat(64), pipelineRunId: "retry-run", inputSha256: "e".repeat(64),
    }, { preserveExistingAi: true })).toBe("noop");

    const { runPvRefresh } = await import("./refresh-run.js");
    const runCapped = () => runPvRefresh({
      ...f.options,
      classification: { ...f.options.classification!, retryLimit: 2, retryWindowDays: 31 },
    });

    f.classificationRequests.length = 0;
    // Pass 1 (capped at 2): classifies newest two (u-upcoming, u-recent).
    expect(await runCapped()).toMatchObject({ status: "up-to-date" });
    expect(f.classificationRequests).toHaveLength(2);
    const afterPass1 = await readClassAnnotations(db, "waterloo");
    expect(afterPass1.has("Signal:u-upcoming")).toBe(true);
    expect(afterPass1.has("DesignationEvent:u-recent")).toBe(true);
    expect(afterPass1.has("Signal:u-older-in-window")).toBe(false);

    // Pass 2 (capped at 2): classifies remaining 1 in-window signal (u-older-in-window).
    expect(await runCapped()).toMatchObject({ status: "up-to-date" });
    expect(f.classificationRequests).toHaveLength(3);
    const afterPass2 = await readClassAnnotations(db, "waterloo");
    expect(afterPass2.has("Signal:u-older-in-window")).toBe(true);

    // Pass 3: nothing left to retry (0 extra model calls).
    expect(await runCapped()).toMatchObject({ status: "up-to-date" });
    expect(f.classificationRequests).toHaveLength(3);

    // Out-of-window, other city, manual, and existing valid AI annotations are untouched.
    expect(afterPass2.has("Signal:u-outside-window")).toBe(false);
    expect((await readClassAnnotations(db, "montreal")).size).toBe(0);
    expect((await db.execute(sql`SELECT source,classe,reason FROM signal_class_annotations WHERE node_id='keep-manual-row'`,
    )).rows).toEqual([{ source: "manual", classe: "ecarte", reason: "Human lock" }]);
    expect((await db.execute(sql`SELECT 1 FROM signal_class_annotations WHERE node_id='keep-manual-event'`)).rows)
      .toHaveLength(0);
    expect((await db.execute(sql`SELECT prompt_id,classe,model FROM signal_class_annotations WHERE node_id='keep-valid-ai'`,
    )).rows).toEqual([{ prompt_id: "p0-v1", classe: "pertinent", model: "legacy-model" }]);
  });
});
