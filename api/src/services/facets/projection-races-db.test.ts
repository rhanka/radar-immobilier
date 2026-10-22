import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { graphSourceRevisions } from "../../db/schema.js";
import { upsertGraph, upsertGraphAtomic } from "../graph/graph-store.js";
import { revokeMembership } from "../workspaces/mutations.js";
import { setMembershipCapability } from "../workspaces/capabilities.js";
import { writeScopedPersonalFacet } from "./scoped-writer.js";
import { writeWorkspaceArchiveFacet } from "./workspace-writer.js";
import { readCoherentProjection, readProjectionScope } from "./projection-revisions.js";
import { describeDb, revisionFixture, revisionCitySignal } from "./projection-revisions-fixture.js";

describeDb("6L1 revision races and source writers", () => {
  it("should isolate cities and workspaces and keep exact replays stable", async () => {
    const f = await revisionFixture();
    const { target, fingerprint } = await revisionCitySignal(f);
    const read = (workspace = f.workspaceId, city = target.citySlug) =>
      readProjectionScope(f.db, f.contributor.sub, workspace, city, "signal");
    const otherWorkspace = await read(f.otherId);
    const otherCity = await read(f.workspaceId, "synthetic-other-city");
    const personalCommand = { action: "select" as const, target, basket: "pertinent" as const,
      expectedHeadId: null, displayedFingerprint: fingerprint, commandKey: randomUUID() };
    await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId, personalCommand);
    const personal = await read();
    await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId, personalCommand);
    expect((await read()).token).toBe(personal.token);
    const commonCommand = { action: "discard" as const, target, reasonCode: "N-NON-RES",
      expectedHeadId: null, displayedFingerprint: fingerprint, commandKey: randomUUID() };
    await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId, commonCommand);
    const common = await read();
    await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId, commonCommand);
    expect((await read()).token).toBe(common.token);
    expect(await read(f.otherId)).toEqual(otherWorkspace);
    expect(await read(f.workspaceId, "synthetic-other-city")).toEqual(otherCity);
  });

  it("should follow actual graph writers, same-content replacement, and preview rollback", async () => {
    const f = await revisionFixture();
    const city = `synthetic-${randomUUID()}`;
    const read = () => readProjectionScope(f.db, f.contributor.sub, f.workspaceId, city, "signal");
    const initial = await read();
    const graph = { nodes: [{ id: "a", type: "Signal", label: "Synthetic evidence" }], links: [] };
    await upsertGraph(f.db, city, graph);
    const inserted = await read();
    expect(inserted.token).not.toBe(initial.token);
    await upsertGraph(f.db, city, graph);
    expect((await read()).token).toBe(inserted.token);
    await upsertGraphAtomic(f.db, city, { ...graph, nodes: [{ ...graph.nodes[0]!, id: "b" }] });
    const replaced = await read();
    expect(replaced.token).not.toBe(inserted.token);
    await upsertGraphAtomic(f.db, city, graph, new Set(), { preview: true });
    expect((await read()).token).toBe(replaced.token);
    await expect(f.db.transaction(async (tx) => {
      await tx.update(graphSourceRevisions).set({ revision: 999 }).where(eq(graphSourceRevisions.citySlug, city));
      throw new Error("synthetic rollback");
    })).rejects.toThrow("synthetic rollback");
    expect((await read()).token).toBe(replaced.token);
  });

  it("should retry source drift during fetch and reject persistent drift or partial failure", async () => {
    const f = await revisionFixture();
    const city = `synthetic-${randomUUID()}`;
    const graph = (label: string) => ({ nodes: [{ id: "a", type: "Signal", label }], links: [] });
    await upsertGraph(f.db, city, graph("old"));
    let attempts = 0;
    const coherent = await readCoherentProjection(f.db, f.contributor.sub, f.workspaceId, city, "signal", async () => {
      attempts++;
      if (attempts === 1) await upsertGraph(f.db, city, graph("new"));
      return attempts;
    });
    expect(coherent.payload).toBe(2);
    expect(attempts).toBe(2);
    await expect(readCoherentProjection(f.db, f.contributor.sub, f.workspaceId, city, "signal", async () => {
      await upsertGraph(f.db, city, graph(`drift-${++attempts}`));
      return attempts;
    })).rejects.toMatchObject({ status: 503, message: "projection_revision_unstable" });
    expect(attempts).toBe(5);
    await expect(readCoherentProjection(f.db, f.contributor.sub, f.workspaceId, city, "signal",
      async () => { throw new Error("partial fetch"); })).rejects.toThrow("partial fetch");
  });

  it("should detect permission changes and reject revocation during payload reads", async () => {
    const f = await revisionFixture();
    const city = "synthetic-city";
    const before = await readProjectionScope(f.db, f.contributor.sub, f.workspaceId, city, "signal");
    await setMembershipCapability(f.db, { workspaceId: f.workspaceId, targetAccountId: f.contributor.id,
      actorSub: f.moderator.sub, reason: "synthetic capability", expectedRevision: before.membershipRevision,
      capability: "moderate_archive", granted: true });
    const after = await readProjectionScope(f.db, f.contributor.sub, f.workspaceId, city, "signal");
    expect(after.token).not.toBe(before.token);
    await expect(readCoherentProjection(f.db, f.contributor.sub, f.workspaceId, city, "signal", async () => {
      await revokeMembership(f.db, { workspaceId: f.workspaceId, targetAccountId: f.contributor.id,
        actorSub: f.moderator.sub, reason: "synthetic revocation", expectedRevision: after.membershipRevision });
      return "must not disclose";
    })).rejects.toMatchObject({ status: 403 });
  });
});
