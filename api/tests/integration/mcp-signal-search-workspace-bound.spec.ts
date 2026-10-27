import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { facadeFixture } from "./mcp-signal-search-facade-fixture.js";

describeDb("MCP workspace binding across second resolution", () => {
  it("refuses a singleton replacement between resolve and scoped entry", async () => {
    const f = await facadeFixture({
      afterWorkspaceResolve: async () => {
        await f.memberships([f.data.otherId]);
      },
    });
    const response = await f.search();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "workspace_context_changed" });
    expect(f.head).not.toHaveBeenCalled();
  });
  it("still rejects an added membership when the selector was omitted", async () => {
    const f = await facadeFixture({
      afterWorkspaceResolve: async () => {
        await f.memberships([f.data.workspaceId, f.data.otherId]);
      },
    });
    const response = await f.search();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "workspace_ambiguous" });
  });
  it("keeps an explicit selector when another membership becomes active", async () => {
    const f = await facadeFixture({
      afterWorkspaceResolve: async () => {
        await f.memberships([f.data.workspaceId, f.data.otherId]);
      },
    });
    const response = await f.search("&workspaceId=" + f.data.workspaceId);
    expect(response.status).toBe(200);
    expect((await response.json()).workspaceId).toBe(f.data.workspaceId);
  });
});
