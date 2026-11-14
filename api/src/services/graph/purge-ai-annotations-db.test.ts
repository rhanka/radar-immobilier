import { sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { describeDb } from "../facets/scope-db-fixture.js";
import { workspaceFixture, workspaceSignal } from "../facets/workspace-archive-fixture.js";
import { readProjectionScope } from "../facets/projection-revisions.js";
import { readScopedByCity } from "../facets/scoped-by-city.js";
import { readScopedPersonalHeads } from "../facets/scoped-reader.js";
import { writeScopedPersonalFacet } from "../facets/scoped-writer.js";
import { randomUUID } from "node:crypto";
import { readClassAnnotations, writeClassAnnotation, type AiClassAnnotation } from "./class-annotations.js";
import { purgeAiAnnotations } from "./purge-ai-annotations.js";

async function setup() {
  const f = await workspaceFixture();
  const { target, fingerprint } = await workspaceSignal(f);
  const annotation: AiClassAnnotation = { citySlug: target.citySlug, nodeType: "Signal", nodeId: target.id,
    classe: "ecarte", reason: "AI decision", ambiguous: false, source: "ai", model: "gpt-6-astra", effort: "low",
    promptId: "v1", promptSha256: "a".repeat(64), pipelineRunId: "run-1", inputSha256: "b".repeat(64) };
  const revision = () => readProjectionScope(f.db, f.contributor.sub, f.workspaceId, target.citySlug, "signal");
  const counts = () => readScopedByCity(f.db, f.contributor.sub, f.workspaceId, { showDiscarded: false });
  const beforeCounts = await counts();
  await writeClassAnnotation(f.db, annotation);
  await f.db.execute(sql`INSERT INTO signal_class_annotations (city_slug,node_type,node_id,classe,reason,source)
    VALUES (${target.citySlug},'Signal','manual','a_surveiller','Human decision','manual')`);
  const rows = () => f.db.execute(sql`SELECT * FROM signal_class_annotations ORDER BY node_id`);
  return { ...f, target, fingerprint, annotation, revision, counts, beforeCounts, rows };
}

describeDb("AI annotation rollback PostgreSQL", () => {
  beforeEach(() => vi.stubEnv("REFRESH_CLASSIFY_MODE", "two-step"));
  afterEach(() => vi.unstubAllEnvs());
  it("should default to dry-run without changing annotations or projection revisions", async () => {
    const f = await setup();
    const before = await f.rows();
    const revision = await f.revision();
    expect(await purgeAiAnnotations(f.db)).toMatchObject({ mode: "dry-run", matched: 1, deleted: 0 });
    expect((await f.rows()).rows).toEqual(before.rows);
    expect(await f.revision()).toEqual(revision);
  });

  it("should keep only manual data, restore prior visibility and be idempotent", async () => {
    const f = await setup();
    const manual = (await f.rows()).rows.filter((row) => row.source === "manual");
    const nodes = await f.db.execute(sql`SELECT * FROM graph_nodes`);
    const events = await f.db.execute(sql`SELECT * FROM facet_events`);
    const before = await f.revision();
    expect((await f.counts()).totalCount).toBe(0);
    expect(await purgeAiAnnotations(f.db, { apply: true, all: true })).toMatchObject({ mode: "apply", matched: 1, deleted: 1 });
    expect((await f.rows()).rows).toEqual(manual);
    expect((await f.db.execute(sql`SELECT * FROM graph_nodes`)).rows).toEqual(nodes.rows);
    expect((await f.db.execute(sql`SELECT * FROM facet_events`)).rows).toEqual(events.rows);
    expect(await f.counts()).toEqual(f.beforeCounts);
    expect((await readClassAnnotations(f.db, f.annotation.citySlug)).has(`Signal:${f.annotation.nodeId}`)).toBe(false);
    const after = await f.revision();
    expect(after.workspaceRevision).toBe(before.workspaceRevision + 1);
    expect(after.token).not.toBe(before.token);
    expect(await purgeAiAnnotations(f.db, { apply: true, all: true })).toMatchObject({ matched: 0, deleted: 0 });
    expect(await f.revision()).toEqual(after);
    expect((await f.rows()).rows).toEqual(manual);
  });

  it.each(["pipelineRunId", "promptSha256"] as const)("should restrict deletion by %s", async (filter) => {
    const f = await setup();
    const other = { ...f.annotation, nodeId: "other", pipelineRunId: "run-2", promptSha256: "c".repeat(64) };
    await writeClassAnnotation(f.db, other);
    expect(await purgeAiAnnotations(f.db, { apply: true, [filter]: f.annotation[filter] })).toMatchObject({ deleted: 1 });
    expect((await readClassAnnotations(f.db, f.annotation.citySlug)).get("Signal:other")).toMatchObject(other);
    expect((await f.rows()).rows.filter((row) => row.source === "manual")).toHaveLength(1);
  });

  it("should preserve the exact human class and history after an AI override was confirmed", async () => {
    const f = await setup();
    await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId, {
      action: "select", basket: "pertinent", target: f.target, displayedFingerprint: f.fingerprint,
      expectedHeadId: null, commandKey: randomUUID(),
    });
    const before = await readScopedPersonalHeads(f.db, f.contributor.sub, f.workspaceId, f.target.citySlug);
    expect(before).toMatchObject([{ target: f.target, basket: "pertinent", state: "active" }]);
    const events = await f.db.execute(sql`SELECT * FROM facet_events`);
    expect((await readClassAnnotations(f.db, f.annotation.citySlug)).get(`Signal:${f.annotation.nodeId}`)?.source).toBe("manual");
    await purgeAiAnnotations(f.db, { apply: true, all: true });
    expect(await readScopedPersonalHeads(f.db, f.contributor.sub, f.workspaceId, f.target.citySlug)).toEqual(before);
    expect((await f.db.execute(sql`SELECT * FROM facet_events`)).rows).toEqual(events.rows);
    const annotations = await readClassAnnotations(f.db, f.annotation.citySlug);
    expect(annotations.has(`Signal:${f.annotation.nodeId}`)).toBe(false);
    expect(annotations.get("Signal:manual")).toMatchObject({ source: "manual",
      classe: "a_surveiller", reason: "Human decision" });
  });

  it("should combine both filters and preserve a matching manual annotation", async () => {
    const f = await setup();
    await f.db.execute(sql`UPDATE signal_class_annotations SET pipeline_run_id='run-1',
      prompt_sha256=${f.annotation.promptSha256} WHERE source='manual'`);
    expect(await purgeAiAnnotations(f.db, { apply: true, pipelineRunId: "run-1", promptSha256: "c".repeat(64) }))
      .toMatchObject({ deleted: 0 });
    expect(await purgeAiAnnotations(f.db, { apply: true, pipelineRunId: "run-1", promptSha256: f.annotation.promptSha256 }))
      .toMatchObject({ deleted: 1 });
    expect((await f.rows()).rows).toMatchObject([{ source: "manual", classe: "a_surveiller" }]);
  });
});
