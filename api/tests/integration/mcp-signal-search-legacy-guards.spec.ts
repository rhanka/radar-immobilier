import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { legacyFacadeFixture } from "./mcp-signal-search-legacy-fixture.js";

describeDb("Pre-6H facade authority and maintenance", () => {
  it.each(["cutover-closed", "retired"] as const)("never reopens a legacy reader fenced as %s", async (state) => {
    const f = await legacyFacadeFixture("legacy", state);
    const legacy = await f.request("/api/graph-signals/synthetic-city");
    const response = await f.search("&showDiscarded=1");
    expect(response.status).toBe(state === "retired" ? 410 : 503);
    expect(response.status).toBe(legacy.status);
    expect(await response.json()).toEqual({ error: state === "retired" ? "legacy_retired" : "legacy_cutover_closed" });
    expect(f.head).not.toHaveBeenCalled();
    expect(f.forViewer).not.toHaveBeenCalled();
  });
  it("propagates legacy archive failure and bypasses it only for explicit reveal", async () => {
    const f = await legacyFacadeFixture();
    f.forViewer.mockRejectedValue(new Error("synthetic archive failure"));
    const legacy = await f.request("/api/graph-signals/synthetic-city");
    const response = await f.search();
    expect(legacy.status).toBe(503);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "discarded_signals_unavailable" });
    expect(f.head).not.toHaveBeenCalled();
    expect((await f.search("&showDiscarded=1")).status).toBe(200);
    expect(f.forViewer).toHaveBeenCalledTimes(2);
  });
  it("checks current approval and 0/1/N membership even for a revealed empty city", async () => {
    const f = await legacyFacadeFixture();
    await f.data.pool.query("DELETE FROM graph_nodes");
    expect((await f.search("&showDiscarded=1")).status).toBe(200);
    expect((await f.search("&workspaceId=" + f.data.otherId)).status).toBe(403);
    await f.data.pool.query("UPDATE workspace_memberships SET status='revoked', revoked_at=now() WHERE account_id=$1", [f.data.contributor.id]);
    expect(await (await f.search("&showDiscarded=1")).json()).toEqual({ error: "workspace_missing" });
    await f.data.pool.query("UPDATE workspace_memberships SET status='active', revoked_at=null WHERE account_id=$1", [f.data.contributor.id]);
    await f.data.pool.query(`INSERT INTO workspace_memberships (workspace_id, account_id)
      VALUES ($1,$2)`, [f.data.otherId, f.data.contributor.id]);
    expect(await (await f.search("&showDiscarded=1")).json()).toEqual({ error: "workspace_ambiguous" });
    expect((await f.search("&showDiscarded=1&workspaceId=" + f.data.workspaceId)).status).toBe(200);
    await f.data.pool.query("UPDATE account_users SET status='suspended' WHERE id=$1", [f.data.contributor.id]);
    expect((await f.search("&showDiscarded=1&workspaceId=" + f.data.workspaceId)).status).toBe(403);
    expect(f.head).not.toHaveBeenCalled();
  });
  it("refuses maintenance on a legacy epoch before enrichment or reveal", async () => {
    const f = await legacyFacadeFixture("legacy");
    await f.data.pool.query("UPDATE facet_activation_state SET maintenance_barrier=true");
    const response = await f.search("&showDiscarded=1");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: `scoped_maintenance_in_progress:${f.data.workspaceId}` });
    expect(f.forViewer).not.toHaveBeenCalled();
    expect(f.head).not.toHaveBeenCalled();
  });
  it.each(["membership", "approval", "barrier", "scoped"] as const)(
    "refuses stale preactivation cards after %s changes during enrichment", async (kind) => {
      const f = await legacyFacadeFixture("legacy");
      await f.data.pool.query("UPDATE graph_nodes SET source_ref='raw/synthetic.pdf'");
      let changed = false;
      f.head.mockImplementation(async () => {
        if (changed) return null;
        changed = true;
        if (kind === "membership") await f.data.pool.query("UPDATE workspace_memberships SET status='revoked', revoked_at=now() WHERE account_id=$1", [f.data.contributor.id]);
        if (kind === "approval") await f.data.pool.query("UPDATE account_users SET status='suspended' WHERE id=$1", [f.data.contributor.id]);
        if (kind === "barrier") await f.data.pool.query("UPDATE facet_activation_state SET maintenance_barrier=true");
        if (kind === "scoped") await f.data.pool.query("UPDATE facet_activation_state SET writer_epoch='scoped'");
        return null;
      });
      const response = await f.search();
      expect(changed).toBe(true);
      expect(response.status).toBe(kind === "membership" || kind === "approval" ? 403 : 503);
      expect(await response.json()).not.toHaveProperty("signals");
    });
  it("never substitutes a random workspace or accepts a caller supplied viewer", async () => {
    const f = await legacyFacadeFixture();
    expect((await f.search("&workspaceId=" + randomUUID())).status).toBe(403);
    expect((await f.search("&sub=" + f.data.moderator.sub)).status).toBe(400);
    expect(f.forViewer).not.toHaveBeenCalled();
  });
});
