import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { networkFixture, networkSearch } from "./mcp-signal-search-network-fixture.js";

describeDb("real API entrypoint signal search", () => {
  it.each(["missing", "legacy", "scoped"] as const)(
    "should serve authorized MCP search in the %s epoch and close on authority changes", async (epoch) => {
      const f = await networkFixture(epoch === "scoped" ? "retired" : "serving", true, epoch, true);
      try {
        const { client } = await f.connect();
        const result = await networkSearch(client);
        expect(result.result.isError).not.toBe(true);
        expect(result.body.signals.map((s: { id: string }) => s.id)).toEqual([f.signal.node.id]);
        const unauthenticated = await fetch(f.apiUrl + "/api/v1/mcp/facets/signals/search?city=synthetic-city");
        expect(unauthenticated.status).toBe(401);
        if (epoch === "missing") await f.data.pool.query(
          "INSERT INTO facet_activation_state (workspace_id, maintenance_barrier) VALUES ($1, true)", [f.data.workspaceId]);
        else await f.data.pool.query("UPDATE facet_activation_state SET maintenance_barrier=true WHERE workspace_id=$1", [f.data.workspaceId]);
        const maintenance = await networkSearch(client);
        expect(maintenance.result.isError).toBe(true);
        expect(maintenance.body).toMatchObject({ upstreamStatus: 503, error: "signal_cutover_in_progress" });
        await f.data.pool.query("UPDATE facet_activation_state SET maintenance_barrier=false WHERE workspace_id=$1", [f.data.workspaceId]);
        await f.data.pool.query("UPDATE workspace_memberships SET status='revoked', revoked_at=now() WHERE account_id=$1", [f.data.contributor.id]);
        const denied = await networkSearch(client);
        expect(denied.result.isError).toBe(true);
        expect(denied.body).toMatchObject({ upstreamStatus: 403, error: "workspace_missing" });
        expect(denied.body).not.toHaveProperty("signals");
        expect(f.requests.every((r) => r.path === "/api/v1/mcp/facets/signals/search")).toBe(true);
      } finally { await f.close(); }
    });
  it("should keep authorized search unavailable when startup activation is absent", async () => {
    const f = await networkFixture("retired", false, "scoped", true);
    try {
      const { client } = await f.connect();
      const denied = await networkSearch(client);
      expect(denied.result.isError).toBe(true);
      expect(denied.body).toMatchObject({ upstreamStatus: 503, error: "signal_capability_unavailable" });
      expect(denied.body).not.toHaveProperty("signals");
    } finally { await f.close(); }
  });
});
