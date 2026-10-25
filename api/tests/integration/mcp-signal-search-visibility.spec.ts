import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { graphNodes } from "../../src/db/schema.js";
import { describeDb, workspaceSignal } from "../../src/services/facets/workspace-archive-fixture.js";
import { readMcpSignalCards } from "../../src/services/facets/mcp-signal-search.js";
import { writeScopedPersonalFacet } from "../../src/services/facets/scoped-writer.js";
import { writeWorkspaceArchiveFacet } from "../../src/services/facets/workspace-writer.js";
import { searchFixture, type SearchFixture } from "./mcp-signal-search-fixture.js";

async function discard(f: SearchFixture, signal: typeof f.signal, scope: "personal" | "workspace", other = false) {
  const command = { action: "discard" as const, target: signal.target, expectedHeadId: null,
    displayedFingerprint: signal.fingerprint, reasonCode: "N-NON-RES", commandKey: randomUUID() };
  return scope === "workspace"
    ? writeWorkspaceArchiveFacet(f.data.db, f.data.moderator.sub, f.data.workspaceId, command)
    : writeScopedPersonalFacet(f.data.db, other ? f.data.moderator.sub : f.data.contributor.sub,
      f.data.workspaceId, command);
}
const snapshot = async (f: SearchFixture) => (await f.data.pool.query(`SELECT
  (SELECT jsonb_agg(e ORDER BY id) FROM facet_events e) AS events,
  (SELECT jsonb_agg(h ORDER BY stream_id) FROM facet_heads h) AS heads,
  (SELECT jsonb_agg(s ORDER BY id) FROM facet_streams s) AS streams`)).rows;

describeDb("MCP coherent BASE visibility through createApp/PostgreSQL", () => {
  it("masks personal OR common archives while leaving another member's personal state private", async () => {
    const f = await searchFixture();
    const common = await workspaceSignal(f.data), both = await workspaceSignal(f.data);
    const other = await workspaceSignal(f.data), visible = await workspaceSignal(f.data);
    await discard(f, f.signal, "personal");
    await discard(f, common, "workspace");
    await discard(f, both, "personal");
    await discard(f, both, "workspace");
    await discard(f, other, "personal", true);
    f.mount((sub, args) => readMcpSignalCards({ db: f.data.db }, sub, args));
    const before = await snapshot(f);
    for (const query of ["", "&showDiscarded=0"]) {
      const response = await f.search(query);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.result.cards.map((node: { id: string }) => node.id).sort())
        .toEqual([other.node.id, visible.node.id].sort());
    }
    const revealed = await (await f.search("&showDiscarded=1")).json();
    expect(revealed.result.cards).toHaveLength(5);
    expect(await snapshot(f)).toEqual(before);
  });
  it("masks by city/type/id and never reveals through an unauthorized selector", async () => {
    const f = await searchFixture();
    await discard(f, f.signal, "personal");
    await f.data.db.insert(graphNodes).values([
      { ...f.signal.node, type: "DesignationEvent" },
      { ...f.signal.node, citySlug: "another-city" },
    ]);
    f.mount((sub, args) => readMcpSignalCards({ db: f.data.db }, sub, args));
    const body = await (await f.search()).json();
    expect(body.result.cards.map((node: { type: string }) => node.type)).toEqual(["DesignationEvent"]);
    expect(await (await f.search("&showDiscarded=1&workspaceId=" + randomUUID())).json())
      .toEqual({ error: "workspace_not_authorized" });
  });
  it("returns an authorized empty city only after BASE scope checks", async () => {
    const f = await searchFixture();
    f.mount((sub, args) => readMcpSignalCards({ db: f.data.db }, sub, { ...args, city: "empty-city" }));
    expect((await (await f.search()).json()).result.cards).toEqual([]);
    await f.memberships([]);
    expect(await (await f.search()).json()).toEqual({ error: "workspace_missing" });
  });
});
