import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { facetEvents, graphNodes } from "../../db/schema.js";
import { attach, activation, describeDb, event, fixture, safety } from "./scope-db-fixture.js";
import { attachPersonalHistory } from "./attachment.js";
import { runPersonalAttachmentActivation } from "./activation-run.js";
import { readScopedPersonalHeads } from "./scoped-reader.js";
import { resumePersonalAttachmentReadback } from "./activation-open.js";
import { writeScopedPersonalFacet } from "./scoped-writer.js";
import { targetFingerprint } from "./target.js";

describeDb("6H protected activation", () => {
  it("should upgrade 0017 with whole chains and replay 0018 without changing historical bytes", async () => {
    const f = await fixture(true);
    const first = await event(f);
    const nextId = randomUUID();
    await f.db.transaction(async (tx) => {
      await tx.update(facetEvents).set({ supersededBy: nextId }).where(eq(facetEvents.id, first.id));
      await tx.insert(facetEvents).values({ ...first, id: nextId, state: "inactive", supersedes: first.id });
    });
    const before = (await f.pool.query("SELECT * FROM facet_events ORDER BY id")).rows;
    await migrate(f.db, { migrationsFolder: "drizzle" });
    await migrate(f.db, { migrationsFolder: "drizzle" });
    await f.pool.query(readFileSync("drizzle/0018_facet_scope_bindings.sql", "utf8"));
    expect((await f.pool.query("SELECT * FROM facet_events ORDER BY id")).rows).toEqual(before);
    expect((await f.pool.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n).toBe(18);
    await attach(f);
    const readback = vi.fn(async () => {
      expect((await f.pool.query("SELECT maintenance_barrier FROM facet_activation_state")).rows)
        .toEqual([{ maintenance_barrier: true }]);
    });
    expect(await runPersonalAttachmentActivation(f.db, activation(f), { ...safety, readback }))
      .toMatchObject({ streamsBound: 1, headsRegistered: 1, sealedUnresolved: [], epoch: "scoped" });
    expect(readback).toHaveBeenCalledOnce();
    expect((await f.pool.query("SELECT * FROM facet_events ORDER BY id")).rows).toEqual(before);
    expect((await readScopedPersonalHeads(f.db, f.member.sub, f.workspaceId, first.citySlug))[0])
      .toMatchObject({ id: nextId, state: "inactive" });
    expect(await readScopedPersonalHeads(f.db, f.actor.sub, f.workspaceId, first.citySlug)).toEqual([]);
    await expect(runPersonalAttachmentActivation(f.db, activation(f), safety))
      .rejects.toMatchObject({ status: 409, message: "activation_already_scoped" });
  });

  it("should keep activation closed without delivery safety or designated management", async () => {
    const f = await fixture();
    await attach(f);
    await expect(runPersonalAttachmentActivation(f.db, activation(f)))
      .rejects.toMatchObject({ status: 503, message: "activation_delivery_safety_required" });
    expect((await f.pool.query("SELECT * FROM facet_activation_state")).rows).toEqual([]);
    await expect(runPersonalAttachmentActivation(f.db, { ...activation(f), actorSub: f.member.sub }, safety))
      .rejects.toMatchObject({ status: 403 });
    await expect(readScopedPersonalHeads(f.db, f.member.sub, f.workspaceId, "synthetic-city"))
      .rejects.toMatchObject({ status: 503 });
  });

  it("should retain the legacy index and committed barrier when draining fails", async () => {
    const f = await fixture();
    await attach(f);
    await expect(runPersonalAttachmentActivation(f.db, activation(f), {
      ...safety, drain: async () => {
        await expect(event(f)).rejects.toMatchObject({ cause: { message: "facet maintenance barrier is closed" } });
        throw new Error("synthetic undrained replica");
      },
    })).rejects.toThrow("synthetic undrained replica");
    expect((await f.pool.query("SELECT writer_epoch, maintenance_barrier FROM facet_activation_state")).rows)
      .toEqual([{ writer_epoch: "legacy", maintenance_barrier: true }]);
    expect((await f.pool.query("SELECT to_regclass('facet_events_head_idx') AS idx")).rows[0].idx).not.toBeNull();
  });

  it("should retain the new authority and closed barrier when authorized readback fails", async () => {
    const f = await fixture();
    await attach(f);
    await event(f);
    await expect(runPersonalAttachmentActivation(f.db, activation(f), {
      ...safety, readback: async () => { throw new Error("synthetic readback failure"); },
    })).rejects.toThrow("synthetic readback failure");
    expect((await f.pool.query("SELECT writer_epoch, maintenance_barrier FROM facet_activation_state")).rows)
      .toEqual([{ writer_epoch: "scoped", maintenance_barrier: true }]);
    expect((await f.pool.query("SELECT to_regclass('facet_events_head_idx') AS idx")).rows[0].idx).toBeNull();
    await expect(readScopedPersonalHeads(f.db, f.member.sub, f.workspaceId, "synthetic-city"))
      .rejects.toMatchObject({ status: 503 });
    await resumePersonalAttachmentReadback(f.db, activation(f), safety);
    expect(await readScopedPersonalHeads(f.db, f.member.sub, f.workspaceId, "synthetic-city")).toHaveLength(1);
  });

  it("should freeze unresolved chains and keep their reading scope unavailable", async () => {
    const f = await fixture();
    const missingParent = await event(f);
    await event(f, { supersedes: missingParent.id });
    await attach(f);
    const readback = vi.fn(safety.readback);
    const receipt = await runPersonalAttachmentActivation(f.db, activation(f), { ...safety, readback });
    expect(receipt.sealedUnresolved).toHaveLength(2);
    expect(readback).not.toHaveBeenCalled();
    await expect(readScopedPersonalHeads(f.db, f.member.sub, f.workspaceId, "synthetic-city"))
      .rejects.toMatchObject({ status: 503 });
    expect((await f.pool.query("SELECT count(*)::int AS n FROM facet_unresolved_events")).rows[0].n).toBe(2);
    await expect(f.pool.query("UPDATE facet_events SET superseded_by = $1 WHERE id = $2",
      [randomUUID(), missingParent.id])).rejects.toThrow();
  });

  it("should activate a second workspace from unlinked chains without blocking the first", async () => {
    const f = await fixture();
    const history = await event(f);
    await attach(f);
    await runPersonalAttachmentActivation(f.db, activation(f), safety);
    const [node] = await f.db.insert(graphNodes).values({ id: randomUUID(), type: "Signal",
      citySlug: "synthetic-city", label: "Synthetic second-scope signal" }).returning();
    const select = { action: "select" as const, basket: "pertinent" as const, target: {
      citySlug: node!.citySlug, type: "Signal" as const, id: node!.id },
    displayedFingerprint: targetFingerprint(node!), expectedHeadId: null, commandKey: randomUUID() };
    const actorFirst = await writeScopedPersonalFacet(f.db, f.actor.sub, f.workspaceId, select);
    expect(actorFirst).toMatchObject({ scope: "personal" });
    const bindings = () => f.pool.query("SELECT * FROM facet_event_bindings ORDER BY event_id");
    const boundBefore = (await bindings()).rows;
    await attachPersonalHistory(f.db, { actorAccountId: f.actor.id, reason: "synthetic second scope",
      entries: [{ accountId: f.actor.id, workspaceId: f.otherId }] });
    await expect(runPersonalAttachmentActivation(f.db, { ...activation(f), workspaceId: f.otherId }, safety))
      .resolves.toMatchObject({ streamsBound: 0, sealedUnresolved: [], epoch: "scoped" });
    expect((await bindings()).rows).toEqual(boundBefore);
    expect((await readScopedPersonalHeads(f.db, f.member.sub, f.workspaceId, "synthetic-city"))
      .map((head) => head.id)).toEqual([history.id]);
    expect(await readScopedPersonalHeads(f.db, f.actor.sub, f.otherId, node!.citySlug)).toEqual([]);
    const actorSecond = await writeScopedPersonalFacet(f.db, f.actor.sub, f.otherId,
      { ...select, commandKey: randomUUID() });
    const inactive = await writeScopedPersonalFacet(f.db, f.actor.sub, f.workspaceId,
      { ...select, action: "deselect", expectedHeadId: actorFirst!.id, commandKey: randomUUID() });
    expect(inactive).toMatchObject({ state: "inactive", supersedes: actorFirst!.id });
    expect((await readScopedPersonalHeads(f.db, f.actor.sub, f.otherId, node!.citySlug))
      .map((head) => head.id)).toEqual([actorSecond!.id]);
  });
});
