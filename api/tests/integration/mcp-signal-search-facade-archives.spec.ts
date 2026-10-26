import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { graphNodes } from "../../src/db/schema.js";
import { describeDb, workspaceSignal } from "../../src/services/facets/workspace-archive-fixture.js";
import { writeScopedPersonalFacet } from "../../src/services/facets/scoped-writer.js";
import { writeWorkspaceArchiveFacet } from "../../src/services/facets/workspace-writer.js";
import { targetFingerprint } from "../../src/services/facets/target.js";
import { facadeFixture, type FacadeFixture } from "./mcp-signal-search-facade-fixture.js";
import { businessSnapshot } from "./mcp-signal-search-fixture.js";

async function discard(f: FacadeFixture, signal: typeof f.signal, scope: "personal" | "workspace", other = false) {
  const command = { action: "discard" as const, target: signal.target, expectedHeadId: null,
    displayedFingerprint: signal.fingerprint, reasonCode: "N-NON-RES", commandKey: randomUUID() };
  return scope === "workspace"
    ? writeWorkspaceArchiveFacet(f.data.db, f.data.moderator.sub, f.data.workspaceId, command)
    : writeScopedPersonalFacet(f.data.db, other ? f.data.moderator.sub : f.data.contributor.sub,
      f.data.workspaceId, command);
}

describeDb("T13 production facade archives", () => {
  it("masks personal OR common archives while leaving another member's personal state private", async () => {
    const f = await facadeFixture();
    const common = await workspaceSignal(f.data), both = await workspaceSignal(f.data);
    const other = await workspaceSignal(f.data), visible = await workspaceSignal(f.data);
    await f.data.pool.query("UPDATE graph_nodes SET source_ref = 'raw/synthetic/hidden.pdf' WHERE id = $1",
      [f.signal.node.id]);
    f.signal.node.sourceRef = "raw/synthetic/hidden.pdf";
    f.signal.fingerprint = targetFingerprint(f.signal.node);
    await writeScopedPersonalFacet(f.data.db, f.data.contributor.sub, f.data.workspaceId,
      { action: "select", target: f.signal.target, basket: "pertinent", expectedHeadId: null,
        displayedFingerprint: f.signal.fingerprint, commandKey: randomUUID() });
    await discard(f, f.signal, "personal");
    await discard(f, common, "workspace");
    await discard(f, both, "personal");
    await discard(f, both, "workspace");
    await discard(f, other, "personal", true);
    const before = await businessSnapshot(f);
    for (const query of ["", "&showDiscarded=0"]) {
      const response = await f.search(query);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.signals.map((node: { id: string }) => node.id).sort())
        .toEqual([other.node.id, visible.node.id].sort());
    }
    expect(f.head).not.toHaveBeenCalled();
    const revealed = await (await f.search("&showDiscarded=1")).json();
    expect(revealed.signals).toHaveLength(5);
    expect(f.head).toHaveBeenCalledTimes(1);
    expect(await businessSnapshot(f)).toEqual(before);
  });
  it("masks by city/type/id and never reveals through an unauthorized selector", async () => {
    const f = await facadeFixture();
    await discard(f, f.signal, "personal");
    await f.data.pool.query("UPDATE graph_nodes SET type = 'DesignationEvent' WHERE city_slug = $1 AND id = $2",
      [f.signal.node.citySlug, f.signal.node.id]);
    await f.data.db.insert(graphNodes).values({ ...f.signal.node, citySlug: "another-city" });
    const body = await (await f.search()).json();
    expect(body.signals.map((node: { type: string }) => node.type)).toEqual(["DesignationEvent"]);
    expect(await (await f.search("&showDiscarded=1&workspaceId=" + randomUUID())).json())
      .toEqual({ error: "workspace_not_authorized" });
  });
  it("returns an authorized empty city only after BASE scope checks", async () => {
    const f = await facadeFixture();
    await f.data.pool.query("DELETE FROM graph_nodes");
    expect((await (await f.search()).json()).signals).toEqual([]);
    await f.memberships([]);
    expect(await (await f.search()).json()).toEqual({ error: "workspace_missing" });
  });
  it("keeps the common archive hidden after personal restoration without changing selections", async () => {
    const f = await facadeFixture();
    const personal = await discard(f, f.signal, "personal");
    await discard(f, f.signal, "workspace");
    await writeScopedPersonalFacet(f.data.db, f.data.contributor.sub, f.data.workspaceId,
      { action: "restore", target: f.signal.target, expectedHeadId: personal!.id,
        displayedFingerprint: f.signal.fingerprint, commandKey: randomUUID() });
    const before = await businessSnapshot(f);
    expect((await (await f.search()).json()).signals).toEqual([]);
    expect((await (await f.search("&showDiscarded=1")).json()).signals).toHaveLength(1);
    expect(await businessSnapshot(f)).toEqual(before);
  });
});
