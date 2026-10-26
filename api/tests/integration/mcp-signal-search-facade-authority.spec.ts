import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { facadeFixture } from "./mcp-signal-search-facade-fixture.js";

describeDb("T13 production facade current authority", () => {
  it("resolves zero, one and several memberships without substitution", async () => {
    const f = await facadeFixture();
    expect((await (await f.search()).json()).workspaceId).toBe(f.data.workspaceId);
    expect(await (await f.search("&workspaceId=" + randomUUID())).json())
      .toEqual({ error: "workspace_not_authorized" });
    await f.memberships([]);
    expect(await (await f.search("&showDiscarded=1")).json()).toEqual({ error: "workspace_missing" });
    await f.memberships([f.data.workspaceId, f.data.otherId]);
    expect(await (await f.search()).json()).toEqual({ error: "workspace_ambiguous" });
    const selected = await f.search("&workspaceId=" + f.data.otherId);
    expect(selected.status).toBe(200);
    expect((await selected.json()).workspaceId).toBe(f.data.otherId);
  });
  it("refuses an outsider's selector and keeps their own authorized destination distinct", async () => {
    const f = await facadeFixture();
    const denied = await f.search("&workspaceId=" + f.data.workspaceId, f.data.outsider.sub);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "workspace_not_authorized" });
    expect(denied.headers.get("cache-control")).toBe("private, no-store");
    expect((await (await f.search("", f.data.outsider.sub)).json()).workspaceId).toBe(f.data.otherId);
  });
  it.each(["pending", "suspended"])("refuses %s accounts before document access", async (status) => {
    const f = await facadeFixture();
    await f.data.pool.query("UPDATE graph_nodes SET source_ref='raw/private.pdf'");
    await f.data.pool.query("UPDATE account_users SET status=$1 WHERE id=$2", [status, f.data.contributor.id]);
    const denied = await f.search("&showDiscarded=1");
    expect(denied.status).toBe(403);
    expect(await denied.json()).not.toHaveProperty("signals");
    expect(denied.headers.get("cache-control")).toBe("private, no-store");
    expect(f.head).not.toHaveBeenCalled();
  });
});
