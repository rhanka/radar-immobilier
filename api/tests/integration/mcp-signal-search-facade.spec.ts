import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { MCP_SIGNAL_SEARCH_PATH, McpSignalSearchResponse } from "../../src/routes/mcp-signal-search.js";
import { facadeFixture } from "./mcp-signal-search-facade-fixture.js";

describeDb("T09 production facade composition", () => {
  it("keeps the binding closed by default, after authentication and before document reads", async () => {
    const f = await facadeFixture({ enabled: false });
    const response = await f.search();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "capability_unavailable" });
    expect(f.head).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie, Authorization");
  });
  it.each([true, false])("refuses absent identity with private headers, auth enabled=%s", async (authEnabled) => {
    const f = await facadeFixture({ authEnabled });
    const response = await f.app.request(MCP_SIGNAL_SEARCH_PATH + "?city=synthetic-city");
    expect(response.status).toBe(401);
    expect(await response.json()).not.toHaveProperty("signals");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie, Authorization");
    expect(f.head).not.toHaveBeenCalled();
  });
  it("returns an explicit authorized empty envelope only after the workspace guards", async () => {
    const f = await facadeFixture();
    await f.data.pool.query("DELETE FROM graph_nodes");
    const response = await f.search();
    expect(response.status).toBe(200);
    expect(McpSignalSearchResponse.parse(await response.json())).toEqual({ ok: true,
      workspaceId: f.data.workspaceId, citySlug: "synthetic-city", signals: [] });
    await f.memberships([]);
    expect((await f.search()).status).toBe(403);
  });
  it.each(["&city=duplicate", "&limit=0", "&showDiscarded=true", "&sub=other", "&workspaceId=default"])(
    "rejects malformed facade query %s", async (query) => {
      const f = await facadeFixture();
      const response = await f.search(query);
      expect(response.status).toBe(400);
      expect(await response.json()).not.toHaveProperty("signals");
      expect(f.head).not.toHaveBeenCalled();
    });
});
