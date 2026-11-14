import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { describeDb, fixture, event } from "../facets/scope-db-fixture.js";
import { workspaceFixture, workspaceSignal } from "../facets/workspace-archive-fixture.js";
import { writeScopedPersonalFacet } from "../facets/scoped-writer.js";
import { readScopedByCity } from "../facets/scoped-by-city.js";
import { readProjectionScope } from "../facets/projection-revisions.js";
import { readClassAnnotations, writeClassAnnotation, type AiClassAnnotation } from "./class-annotations.js";

const input: AiClassAnnotation = { citySlug: "synthetic-city", nodeType: "Signal", nodeId: "test-ai",
  classe: "pertinent", reason: "Residential density increase", ambiguous: false, source: "ai", model: "gpt-6-astra",
  effort: "medium", promptId: "p0-v1", promptSha256: "a".repeat(64),
  pipelineRunId: "run-1", inputSha256: "b".repeat(64) };

describeDb("single-pass class annotations PostgreSQL", () => {
  it("should increment the shared manual projection revision for AI changes only", async () => {
    const f = await workspaceFixture();
    const { target } = await workspaceSignal(f);
    const read = (sub = f.contributor.sub) => readProjectionScope(f.db, sub, f.workspaceId, target.citySlug, "signal");
    const before = await read();
    const annotation = { ...input, nodeId: target.id, citySlug: target.citySlug };
    await writeClassAnnotation(f.db, annotation);
    const after = await read();
    expect(after.workspaceRevision).toBe(before.workspaceRevision + 1);
    expect(after.token).not.toBe(before.token);
    expect((await read(f.moderator.sub)).workspaceRevision).toBe(after.workspaceRevision);
    await writeClassAnnotation(f.db, annotation);
    expect((await read()).token).toBe(after.token);
    await writeClassAnnotation(f.db, { ...annotation, classe: "ecarte", promptSha256: "c".repeat(64) });
    expect((await read()).workspaceRevision).toBe(after.workspaceRevision + 1);
  });
  it("should include AI discarded classes in scoped city visibility and retain human precedence", async () => {
    const f = await workspaceFixture();
    const { target, fingerprint } = await workspaceSignal(f);
    await writeClassAnnotation(f.db, { ...input, nodeId: target.id, classe: "ecarte" });
    expect((await readScopedByCity(f.db, f.contributor.sub, f.workspaceId, { showDiscarded: false })).totalCount).toBe(0);
    expect((await readScopedByCity(f.db, f.contributor.sub, f.workspaceId, { showDiscarded: true })).totalCount).toBe(1);
    await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId, {
      action: "deselect", basket: "pertinent", target, displayedFingerprint: fingerprint,
      expectedHeadId: null, commandKey: randomUUID(),
    });
    expect((await readScopedByCity(f.db, f.contributor.sub, f.workspaceId, { showDiscarded: false })).totalCount).toBe(1);
  });
  it("should persist a manual Non classé override without previous human history", async () => {
    const f = await workspaceFixture();
    const { target, fingerprint } = await workspaceSignal(f);
    const automatic = { ...input, nodeId: target.id };
    await writeClassAnnotation(f.db, automatic);
    const result = await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId, {
      action: "deselect", basket: "pertinent", target, displayedFingerprint: fingerprint,
      expectedHeadId: null, commandKey: randomUUID(),
    });
    expect(result?.state).toBe("inactive");
    expect(await writeClassAnnotation(f.db, { ...automatic, promptSha256: "c".repeat(64) })).toBe("manual");
  });
  it("should persist exact provenance and no-op unchanged model, prompt and input", async () => {
    const f = await fixture();
    expect(await writeClassAnnotation(f.db, input)).toBe("written");
    expect((await readClassAnnotations(f.db, input.citySlug)).get("Signal:test-ai")).toEqual(input);
    expect(await writeClassAnnotation(f.db, { ...input, pipelineRunId: "run-2" })).toBe("noop");
    expect((await readClassAnnotations(f.db, input.citySlug)).get("Signal:test-ai")?.pipelineRunId).toBe("run-1");
    expect(await writeClassAnnotation(f.db, { ...input, ambiguous: true, promptSha256: "c".repeat(64) })).toBe("written");
    expect((await readClassAnnotations(f.db, input.citySlug)).get("Signal:test-ai")?.ambiguous).toBe(true);
    expect(await writeClassAnnotation(f.db, { ...input, promptSha256: "d".repeat(64) })).toBe("written");
    expect((await readClassAnnotations(f.db, input.citySlug)).get("Signal:test-ai")?.ambiguous).toBe(false);
  });

  it("should preserve human history even when the human selection is inactive", async () => {
    const f = await fixture();
    await event(f, { nodeId: input.nodeId, state: "inactive" });
    expect(await writeClassAnnotation(f.db, input)).toBe("manual");
    const rows = await f.db.execute(sql`SELECT * FROM signal_class_annotations`);
    expect(rows.rows).toEqual([]);
    expect((await readClassAnnotations(f.db, input.citySlug)).has("Signal:test-ai")).toBe(false);
  });

  it("should expose a real manual annotation stored without facet history", async () => {
    const f = await fixture();
    await f.db.execute(sql`INSERT INTO signal_class_annotations
      (city_slug, node_type, node_id, classe, reason, source)
      VALUES (${input.citySlug}, ${input.nodeType}, ${input.nodeId}, 'pertinent', 'Stored human annotation', 'manual')`);
    expect((await readClassAnnotations(f.db, input.citySlug)).get("Signal:test-ai")).toMatchObject({
      source: "manual", classe: "pertinent", reason: "Stored human annotation", model: null,
    });
  });

  it("should let later human history replace the displayed AI provenance", async () => {
    const f = await fixture();
    await writeClassAnnotation(f.db, input);
    await event(f, { nodeId: input.nodeId });
    const annotation = (await readClassAnnotations(f.db, input.citySlug)).get("Signal:test-ai");
    expect(annotation?.source).toBe("manual");
    expect(annotation?.model).toBeNull();
    expect(await writeClassAnnotation(f.db, { ...input, promptSha256: "c".repeat(64) })).toBe("manual");
  });
});
