import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb, workspaceSignal } from "../../src/services/facets/workspace-archive-fixture.js";
import { writeScopedPersonalFacet } from "../../src/services/facets/scoped-writer.js";
import { writeWorkspaceArchiveFacet } from "../../src/services/facets/workspace-writer.js";
import { mcpFixture, search, type McpFixture } from "./a2base-mcp-fixture.js";

async function snapshot(f: McpFixture) {
  return Promise.all(["facet_events", "facet_heads", "facet_streams", "facet_event_bindings", "facet_activation_state",
    "personal_projection_revisions", "workspace_projection_revisions", "prospect_marks"].map(async (table) =>
    (await f.data.pool.query(`SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM ${table} t`)).rows));
}
describeDb("T10 scoped MCP visibility through createApp/PostgreSQL", () => {
  it("masks personal OR common archives and preserves other members' privacy without writes", async () => {
    const f = await mcpFixture();
    try {
      const common = await workspaceSignal(f.data), other = await workspaceSignal(f.data), visible = await workspaceSignal(f.data);
      for (const [signal, owner, shared] of [
        [f.signal, f.data.contributor.sub, false], [common, f.data.moderator.sub, true],
        [other, f.data.moderator.sub, false],
      ] as const) {
        const cmd = { action: "discard" as const, target: signal.target, expectedHeadId: null,
          displayedFingerprint: signal.fingerprint, reasonCode: "N-NON-RES", commandKey: randomUUID() };
        if (shared) await writeWorkspaceArchiveFacet(f.data.db, owner, f.data.workspaceId, cmd);
        else await writeScopedPersonalFacet(f.data.db, owner, f.data.workspaceId, cmd);
      }
      const before = await snapshot(f);
      const { client } = await f.connect();
      for (const args of [{}, { showDiscarded: false }]) {
        const { result, body } = await search(client, args);
        expect(result.isError).not.toBe(true);
        expect(body.signals.map((s: { id: string }) => s.id).sort()).toEqual([other.node.id, visible.node.id].sort());
      }
      expect((await search(client, { showDiscarded: true })).body.signals).toHaveLength(4);
      expect(await snapshot(f)).toEqual(before);
    } finally { await f.close(); }
  });
  it("allows a validated empty city and rejects ambiguous current membership", async () => {
    const f = await mcpFixture();
    try {
      const { client } = await f.connect();
      expect((await search(client, { city: "empty-city" })).body).toMatchObject({ city: "empty-city", count: 0, signals: [] });
      await f.data.pool.query("UPDATE workspace_memberships SET status='active', revoked_at=NULL WHERE workspace_id=$1 AND account_id=$2", [f.data.otherId, f.data.contributor.id]);
      const denied = await search(client);
      expect(denied.result.isError).toBe(true);
      expect(denied.body.error).toBe("workspace_ambiguous");
      expect(denied.body.message).not.toMatch(/workspaceId|selector/);
    } finally { await f.close(); }
  });
});
