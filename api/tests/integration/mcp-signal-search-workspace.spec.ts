import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { resolveMcpSignalWorkspace, revalidateMcpSignalWorkspace } from "../../src/services/facets/mcp-signal-workspace.js";
import { MCP_SIGNAL_SEARCH_PATH } from "../../src/routes/mcp-signal-search.js";
import { searchFixture, barrier } from "./mcp-signal-search-fixture.js";

describeDb("MCP workspace resolution through createApp/PostgreSQL", () => {
  it("has no production search mount and refuses unauthenticated probes", async () => {
    const f = await searchFixture();
    expect((await f.search()).status).toBe(404);
    f.mount((sub, args) => resolveMcpSignalWorkspace(f.data.db, sub, args.workspaceId));
    expect((await f.app.request(MCP_SIGNAL_SEARCH_PATH)).status).toBe(401);
  });
  it("resolves only 0/1/N current memberships without substituting a selector", async () => {
    const f = await searchFixture();
    f.mount((sub, args) => resolveMcpSignalWorkspace(f.data.db, sub, args.workspaceId));
    expect(await (await f.search()).json()).toEqual({ ok: true, result: f.data.workspaceId });
    expect(await (await f.search("&workspaceId=" + randomUUID())).json())
      .toEqual({ error: "workspace_not_authorized" });
    expect(await (await f.search("&workspaceId=default")).json()).toEqual({ error: "workspace_malformed" });
    await f.memberships([]);
    expect(await (await f.search()).json()).toEqual({ error: "workspace_missing" });
    await f.memberships([f.data.workspaceId, f.data.otherId]);
    expect(await (await f.search()).json()).toEqual({ error: "workspace_ambiguous" });
    expect(await (await f.search("&workspaceId=" + f.data.otherId)).json())
      .toEqual({ ok: true, result: f.data.otherId });
  });
  it.each(["added", "removed", "replaced"])("rejects %s memberships during a wait", async (change) => {
    const f = await searchFixture();
    const started = barrier(), resume = barrier();
    f.mount(async (sub, args) => {
      const id = await resolveMcpSignalWorkspace(f.data.db, sub, args.workspaceId);
      started.release();
      await resume.waiting;
      await revalidateMcpSignalWorkspace(f.data.db, sub, id, args.workspaceId);
      return id;
    });
    const response = f.search();
    await started.waiting;
    try {
      await f.memberships(change === "added" ? [f.data.workspaceId, f.data.otherId]
        : change === "removed" ? [] : [f.data.otherId]);
    } finally { resume.release(); }
    expect(await (await response).json()).toEqual({ error: change === "added" ? "workspace_ambiguous"
      : change === "removed" ? "workspace_missing" : "workspace_context_changed" });
  });
  it("rejects an unapproved account before resolving memberships", async () => {
    const f = await searchFixture();
    f.mount((sub) => resolveMcpSignalWorkspace(f.data.db, sub));
    await f.data.pool.query("UPDATE account_users SET status = 'pending' WHERE id = $1", [f.data.contributor.id]);
    const response = await f.search();
    expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty("result");
  });
});
