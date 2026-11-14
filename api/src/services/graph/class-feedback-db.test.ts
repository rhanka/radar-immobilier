import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { describeDb, workspaceFixture, workspaceSignal } from "../facets/workspace-archive-fixture.js";
import { readScopedPersonalHeads } from "../facets/scoped-reader.js";
import { readProjectionScope } from "../facets/projection-revisions.js";
import { classFeedbackRoute } from "../../routes/class-feedback.js";
import { writeClassAnnotation, readClassAnnotations, type AiClassAnnotation } from "./class-annotations.js";
import { writeClassFeedback } from "./class-feedback.js";
import { readClassFeedback, exportClassFeedback } from "./class-feedback-reader.js";
import type { ClassFeedbackCommand } from "./class-feedback-command.js";
import { purgeAiAnnotations } from "./purge-ai-annotations.js";
import { writeScopedPersonalFacet } from "../facets/scoped-writer.js";
import { writeWorkspaceArchiveFacet } from "../facets/workspace-writer.js";

async function setup() {
  const f = await workspaceFixture();
  const { target, fingerprint } = await workspaceSignal(f);
  const ai: AiClassAnnotation = { citySlug: target.citySlug, nodeType: target.type, nodeId: target.id,
    classe: "pertinent", reason: "Residential density increase", source: "ai", model: "gpt-6-astra",
    effort: "low", promptId: "p0-v1", promptSha256: "a".repeat(64), pipelineRunId: "run-1", inputSha256: "b".repeat(64) };
  await writeClassAnnotation(f.db, ai);
  const annotation = (await readClassAnnotations(f.db, target.citySlug, { includeDates: true })).get(`Signal:${target.id}`)!;
  const command: ClassFeedbackCommand = { target, displayedFingerprint: fingerprint, scope: "personal", verdict: "up",
    annotation: { source: "ai", model: ai.model, classe: ai.classe, promptSha256: ai.promptSha256,
      pipelineRunId: ai.pipelineRunId, updatedAt: annotation.updatedAt! },
    selectionHeads: { pertinent: null, a_surveiller: null }, archives: { personal: null, workspace: null }, commandKey: randomUUID() };
  const submit = (cmd = command, sub = f.contributor.sub) => writeClassFeedback(f.db, sub, f.workspaceId, cmd);
  return { ...f, target, ai, command, submit };
}

describeDb("human classification feedback PostgreSQL", () => {
  it.each(["a_surveiller", "personal", "workspace"] as const)("should reject an unexpected %s head without feedback writes", async (scope) => {
    const f = await setup();
    const base = { target: f.target, displayedFingerprint: f.command.displayedFingerprint,
      commandKey: randomUUID(), expectedHeadId: null };
    if (scope === "a_surveiller") {
      await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
        { ...base, action: "select", basket: "a_surveiller" });
    } else {
      const codes = await f.db.execute(sql`SELECT code FROM facet_reason_codes WHERE verdict='non_pertinent' LIMIT 1`);
      const command = { ...base, action: "discard" as const, reasonCode: String(codes.rows[0]!.code) };
      if (scope === "workspace") await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId, command);
      else await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId, command);
    }
    const before = await f.db.execute(sql`SELECT id FROM facet_events ORDER BY id`);
    await expect(f.submit()).rejects.toMatchObject({ status: 409, message: "annotation_version_conflict" });
    expect((await f.db.execute(sql`SELECT id FROM facet_events ORDER BY id`)).rows).toEqual(before.rows);
    expect((await f.db.execute(sql`SELECT * FROM signal_class_feedback`)).rows).toHaveLength(0);
  });
  it("should reject a stale negative HTTP command after another tab validates", async () => {
    const f = await setup();
    await f.submit();
    const before = await f.db.execute(sql`SELECT id FROM facet_events ORDER BY id`);
    const receipts = await f.db.execute(sql`SELECT * FROM facet_commands ORDER BY command_key`);
    const app = new Hono();
    app.use("*", async (c, next) => { c.set("session" as never, { sub: f.contributor.sub } as never); await next(); });
    app.route("/", classFeedbackRoute({ db: f.db, auth: { enabled: true } }));
    const { commandKey: _key, ...body } = f.command;
    const result = await app.request(`/api/v1/workspaces/${f.workspaceId}/signal-facets/class-feedback`, {
      method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ ...body, verdict: "down", nextClass: "a_surveiller", reasonCode: "S-PLANIFIE" }),
    });
    expect(result.status).toBe(409);
    expect(await result.json()).toEqual({ error: "annotation_version_conflict" });
    expect((await f.db.execute(sql`SELECT id FROM facet_events ORDER BY id`)).rows).toEqual(before.rows);
    expect((await f.db.execute(sql`SELECT * FROM facet_commands ORDER BY command_key`)).rows).toEqual(receipts.rows);
    expect((await f.db.execute(sql`SELECT * FROM signal_class_feedback`)).rows).toHaveLength(1);
    expect(await readScopedPersonalHeads(f.db, f.contributor.sub, f.workspaceId, f.target.citySlug))
      .toMatchObject([{ basket: "pertinent", state: "active" }]);
  });
  it("should commit only one of two concurrent classifications of the same version", async () => {
    const f = await setup();
    const results = await Promise.allSettled([
      f.submit(),
      f.submit({ ...f.command, commandKey: randomUUID(), verdict: "down",
        nextClass: "a_surveiller", reasonCode: "S-PLANIFIE" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected"))
      .toMatchObject({ reason: { status: 409, message: "annotation_version_conflict" } });
    const feedback = (await f.db.execute(sql`SELECT human_class FROM signal_class_feedback`)).rows;
    expect(feedback).toHaveLength(1);
    const heads = await readScopedPersonalHeads(f.db, f.contributor.sub, f.workspaceId, f.target.citySlug);
    expect(heads.filter((head) => head.state === "active").map((head) => head.basket))
      .toEqual([feedback[0]!.human_class]);
    expect((await f.db.execute(sql`SELECT * FROM facet_events`)).rows).toHaveLength(1);
  });
  it("should compare the exact PostgreSQL timestamp and history version", async () => {
    const f = await setup();
    await f.db.execute(sql`UPDATE signal_class_annotations SET updated_at='2026-11-13T12:00:00.123456Z'`);
    await expect(f.submit({ ...f.command, annotation: { ...f.command.annotation,
      updatedAt: "2026-11-13T12:00:00.123457Z" } })).rejects.toThrow("annotation_version_conflict");
    await f.submit({ ...f.command, annotation: { ...f.command.annotation, updatedAt: "2026-11-13T12:00:00.123456Z" } });
    const history = await f.db.execute(sql`SELECT h.created_at::text AS date FROM signal_class_feedback f
      JOIN signal_class_annotation_history h ON h.id=f.annotation_id`);
    expect(history.rows[0]!.date).toContain("12:00:00.123456");
  });
  it("should preserve immutable AI versions and skip duplicate reannotation", async () => {
    const f = await setup();
    await writeClassAnnotation(f.db, f.ai);
    await writeClassAnnotation(f.db, { ...f.ai, promptSha256: "c".repeat(64) });
    expect((await f.db.execute(sql`SELECT * FROM signal_class_annotation_history`)).rows).toHaveLength(2);
    await expect(f.pool.query("UPDATE signal_class_annotation_history SET reason='changed'")).rejects.toThrow(/append-only/);
    await expect(f.pool.query("DELETE FROM signal_class_annotation_history")).rejects.toThrow(/append-only/);
  });
  it("should freeze positives, increment revisions, retain provenance and replay once", async () => {
    const f = await setup();
    const before = await readProjectionScope(f.db, f.contributor.sub, f.workspaceId, f.target.citySlug, "signal");
    const id = await f.submit();
    expect(await f.submit()).toBe(id);
    const rows = await readClassFeedback(f.db, f.contributor.sub, f.workspaceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ verdict: "up", humanClass: "pertinent", reason: `validé : ${f.ai.reason}` });
    expect((await readScopedPersonalHeads(f.db, f.contributor.sub, f.workspaceId, f.target.citySlug))[0]).toMatchObject({ state: "active", basket: "pertinent" });
    expect((await readProjectionScope(f.db, f.contributor.sub, f.workspaceId, f.target.citySlug, "signal")).personalRevision).toBe(before.personalRevision + 1);
    expect(await writeClassAnnotation(f.db, { ...f.ai, promptSha256: "c".repeat(64) })).toBe("manual");
    await expect(f.pool.query("DELETE FROM signal_class_feedback")).rejects.toThrow(/append-only/);
    expect(await readClassFeedback(f.db, f.moderator.sub, f.workspaceId)).toHaveLength(0);
    const exported = await exportClassFeedback(f.db, f.contributor.sub, f.workspaceId);
    expect(exported.aggregates[0]).toMatchObject({ up: 1, down: 0, positiveRate: 1, confusions: { "pertinent->pertinent": 1 } });
    expect(exported.byModel[0]).toMatchObject({ model: f.ai.model, positiveRate: 1 });
    expect(exported.byPrompt[0]).toMatchObject({ promptSha256: f.ai.promptSha256, positiveRate: 1 });
  });
  it("should reject missing reclassification with HTTP 400", async () => {
    const f = await setup();
    const app = new Hono();
    app.use("*", async (c, next) => { c.set("session" as never, { sub: f.contributor.sub } as never); await next(); });
    app.route("/", classFeedbackRoute({ db: f.db, auth: { enabled: true } }));
    const { commandKey, ...body } = f.command;
    const result = await app.request(`/api/v1/workspaces/${f.workspaceId}/signal-facets/class-feedback`, {
      method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": commandKey },
      body: JSON.stringify({ ...body, verdict: "down" }),
    });
    expect(result.status).toBe(400);
    expect((await f.db.execute(sql`SELECT * FROM signal_class_feedback`)).rows).toHaveLength(0);
  });
  it("should commit a negative replacement and roll back invalid reasons", async () => {
    const f = await setup();
    await expect(f.submit({ ...f.command, verdict: "down", nextClass: "ecarte", reasonCode: "BAD" })).rejects.toThrow("invalid_reclassification_reason");
    expect((await f.db.execute(sql`SELECT * FROM facet_events`)).rows).toHaveLength(0);
    const codes = await f.db.execute(sql`SELECT code FROM facet_reason_codes WHERE verdict='non_pertinent' LIMIT 1`);
    await f.submit({ ...f.command, verdict: "down", nextClass: "ecarte", reasonCode: String(codes.rows[0]!.code) });
    expect((await f.db.execute(sql`SELECT f.human_class,e.source,e.state FROM signal_class_feedback f JOIN facet_events e ON e.id=f.event_id`)).rows)
      .toEqual([{ human_class: "ecarte", source: "manual", state: "active" }]);
  });
  it("should roll back manual events if inserting feedback fails", async () => {
    const f = await setup();
    await f.db.execute(sql`CREATE FUNCTION synthetic_feedback_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$`);
    await f.db.execute(sql`CREATE TRIGGER synthetic_failure BEFORE INSERT ON signal_class_feedback FOR EACH ROW EXECUTE FUNCTION synthetic_feedback_failure()`);
    await expect(f.submit()).rejects.toMatchObject({ cause: { message: "synthetic failure" } });
    expect((await f.db.execute(sql`SELECT * FROM facet_events`)).rows).toHaveLength(0);
    expect((await f.db.execute(sql`SELECT * FROM facet_heads`)).rows).toHaveLength(0);
  });
  it("should reject stale AI versions and refuse outsiders and unprivileged shared writes", async () => {
    const f = await setup();
    await expect(f.submit(f.command, f.outsider.sub)).rejects.toThrow();
    await expect(f.submit({ ...f.command, scope: "workspace" })).rejects.toThrow("workspace_capability_required");
    await expect(exportClassFeedback(f.db, f.outsider.sub, f.workspaceId)).rejects.toThrow();
    await writeClassAnnotation(f.db, { ...f.ai, promptSha256: "c".repeat(64) });
    await expect(f.submit()).rejects.toThrow("annotation_version_conflict");
    expect((await f.db.execute(sql`SELECT * FROM signal_class_feedback`)).rows).toHaveLength(0);
  });
  it("should validate an AI archive without fabricating a reason and preserve audit through purge", async () => {
    const f = await setup();
    await writeClassAnnotation(f.db, { ...f.ai, classe: "ecarte", inputSha256: "c".repeat(64) });
    const ai = (await readClassAnnotations(f.db, f.target.citySlug, { includeDates: true })).get(`Signal:${f.target.id}`)!;
    await f.submit({ ...f.command, scope: "workspace", annotation: { ...f.command.annotation,
      classe: "ecarte", updatedAt: ai.updatedAt! } }, f.moderator.sub);
    const feedback = await readClassFeedback(f.db, f.contributor.sub, f.workspaceId);
    expect(feedback[0]).toMatchObject({ verdict: "up", humanClass: "ecarte", reasonCode: null });
    await purgeAiAnnotations(f.db, { apply: true, pipelineRunId: f.ai.pipelineRunId });
    expect((await f.db.execute(sql`SELECT * FROM signal_class_annotation_history`)).rows).toHaveLength(2);
    expect(await readClassFeedback(f.db, f.contributor.sub, f.workspaceId)).toHaveLength(1);
  });
});
