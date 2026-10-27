import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { facetEventBindings, facetHeads, facetStreams } from "../../db/schema.js";
import { activation, attach, describeDb, event, fixture, safety } from "./scope-db-fixture.js";
import { runPersonalAttachmentActivation } from "./activation-run.js";

describeDb("6H SQL stream authority", () => {
  it("should enforce stream uniqueness independently in both workspaces including null archive baskets", async () => {
    const f = await fixture();
    for (const workspaceId of [f.workspaceId, f.otherId]) {
      for (const facet of ["selection", "archive"]) {
        const identity = { workspaceId, ownerId: f.member.id, scope: "personal", targetType: "signal",
          citySlug: "synthetic-city", nodeType: "Signal", nodeId: "synthetic-target",
          facet, basket: facet === "archive" ? null : "pertinent" };
        await f.db.insert(facetStreams).values(identity);
        await expect(f.db.insert(facetStreams).values(identity)).rejects.toThrow();
      }
    }
    expect((await f.pool.query("SELECT count(*)::int AS n FROM facet_streams")).rows[0].n).toBe(4);
    await expect(f.pool.query("UPDATE facet_streams SET node_id = 'altered'"))
      .rejects.toThrow(/immutable/);
  });

  it("should reject personal to workspace conversion when a personal archive is bound", async () => {
    const f = await fixture();
    const archive = await event(f, { facet: "archive", basket: null, profileId: "immo-steve-2026-09",
      reasonCode: "N-NON-RES", verdict: "non_pertinent" });
    await expect(f.db.transaction(async (tx) => {
      const [stream] = await tx.insert(facetStreams).values({ workspaceId: f.workspaceId,
        scope: "workspace", ownerId: null, targetType: "signal", citySlug: archive.citySlug,
        nodeType: archive.nodeType, nodeId: archive.nodeId, facet: archive.facet, basket: null }).returning();
      await tx.insert(facetEventBindings).values({ eventId: archive.id, streamId: stream!.id });
      await tx.insert(facetHeads).values({ eventId: archive.id, streamId: stream!.id });
    })).rejects.toMatchObject({ cause: { message: expect.stringMatching(/identity mismatch/) } });
    expect((await f.pool.query("SELECT * FROM facet_event_bindings")).rows).toEqual([]);
    expect((await f.pool.query("SELECT scope, owner_id FROM facet_events")).rows)
      .toEqual([{ scope: "personal", owner_id: f.member.id }]);
  });

  it("should forbid new unbound events and contextless receipts globally after the index swap", async () => {
    const f = await fixture();
    await attach(f);
    await runPersonalAttachmentActivation(f.db, activation(f), safety);
    await expect(event(f)).rejects.toMatchObject({ cause: { message: expect.stringMatching(/without a stream binding/) } });
    await expect(event(f, { ownerId: f.actor.id, actorId: f.actor.id }))
      .rejects.toMatchObject({ cause: { message: expect.stringMatching(/without a stream binding/) } });
    await expect(f.pool.query(`INSERT INTO facet_commands(owner_id, command_key, command_digest, result)
      VALUES ($1, $2, $3, '{"event":null}')`, [f.member.id, randomUUID(), "b".repeat(64)]))
      .rejects.toThrow(/requires context/);
    await expect(f.pool.query("SELECT facet_swap_head_enforcement($1)", [f.otherId]))
      .rejects.toThrow(/maintenance barrier/);
    await expect(f.pool.query("UPDATE facet_activation_state SET writer_epoch = 'legacy'"))
      .rejects.toThrow(/cannot revert/);
    await expect(f.pool.query("DELETE FROM facet_activation_state")).rejects.toThrow(/immutable/);
    await expect(f.pool.query("TRUNCATE facet_activation_state")).rejects.toThrow(/immutable/);
    const client = await f.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO facet_activation_state(workspace_id, maintenance_barrier) VALUES ($1, true)", [f.otherId]);
      await expect(client.query("SELECT facet_swap_head_enforcement($1)", [f.otherId]))
        .rejects.toThrow(/committed maintenance barrier/);
    } finally { await client.query("ROLLBACK"); client.release(); }
  });

  it("should reject partial binding and orphan terminal registration even before cutover", async () => {
    const f = await fixture();
    const original = await event(f);
    const [stream] = await f.db.insert(facetStreams).values({ workspaceId: f.workspaceId,
      scope: "personal", ownerId: f.member.id, targetType: "signal", citySlug: original.citySlug,
      nodeType: original.nodeType, nodeId: original.nodeId, facet: original.facet,
      basket: original.basket }).returning();
    await expect(f.db.insert(facetEventBindings).values({ eventId: original.id, streamId: stream!.id }))
      .rejects.toMatchObject({ cause: { message: expect.stringMatching(/register the terminal/) } });
    await expect(f.db.insert(facetHeads).values({ eventId: original.id, streamId: stream!.id }))
      .rejects.toThrow();
    await f.db.transaction(async (tx) => {
      await tx.insert(facetEventBindings).values({ eventId: original.id, streamId: stream!.id });
      await tx.insert(facetHeads).values({ eventId: original.id, streamId: stream!.id });
    });
    await expect(f.pool.query("DELETE FROM facet_heads")).rejects.toThrow(/never deletion/);
    await expect(f.pool.query("UPDATE facet_event_bindings SET stream_id = $1", [stream!.id]))
      .rejects.toThrow(/immutable/);
  });
});
