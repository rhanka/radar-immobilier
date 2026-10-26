import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../../src/app.js";
import type { ObjectStore } from "../../src/storage/object-store.js";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { unresolvedRevisionFixture } from "../../src/services/facets/projection-revisions-fixture.js";
import { readMcpSignalCards } from "../../src/services/facets/mcp-signal-search.js";
import { ScopeError } from "../../src/services/facets/scope.js";
import { facetActivationState } from "../../src/db/schema.js";
import { initializeWorkspaceStore } from "../../src/services/workspaces/init-store.js";
import { baseAuth, baseCookie } from "./base-api-fixture.js";
import { searchFixture } from "./mcp-signal-search-fixture.js";

describeDb("MCP BASE scope refusal states", () => {
  it.each(["missing", "legacy", "barrier"])("refuses a %s epoch even for an empty reveal", async (state) => {
    const f = await searchFixture();
    let workspaceId = f.data.workspaceId;
    if (state !== "barrier") {
      const created = await initializeWorkspaceStore(f.data.db, {
        workspaceSlug: `synthetic-${randomUUID()}`, workspaceLabel: "Unactivated search",
        approvedAccountIds: [f.data.moderator.id, f.data.contributor.id],
        managerAccountIds: [f.data.moderator.id], moderatorAccountIds: [],
        actorAccountId: f.data.moderator.id, reason: "synthetic closed scope",
      });
      workspaceId = created.workspaceId;
      await f.memberships([workspaceId]);
      if (state === "legacy") await f.data.db.insert(facetActivationState).values({ workspaceId });
    } else {
      await f.data.pool.query("UPDATE facet_activation_state SET maintenance_barrier = true WHERE workspace_id = $1",
        [workspaceId]);
    }
    f.mount((sub, args) => readMcpSignalCards({ db: f.data.db, store: f.store }, sub, { ...args, city: "empty-city" }));
    const response = await f.search("&showDiscarded=1");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: state === "barrier"
      ? `scoped_maintenance_in_progress:${workspaceId}`
      : `scoped_facet_scope_unavailable:${workspaceId}` });
    expect(f.head).not.toHaveBeenCalled();
  });
  it("refuses unresolved personal history before returning empty or revealed cards", async () => {
    const f = await unresolvedRevisionFixture();
    const store = {} as ObjectStore;
    const app = createApp({ db: f.db, store, auth: baseAuth,
      checkDb: async () => ({ ok: true }), checkObjectStore: async () => ({ ok: true }) });
    app.get("/api/__test/a2base-history", async (c) => {
      const session = c.get("session" as never) as { sub: string };
      try {
        const result = await readMcpSignalCards({ db: f.db, store }, session.sub,
          { city: "empty-city", showDiscarded: true, limit: 20 });
        return c.json({ result } as never);
      } catch (error) {
        if (error instanceof ScopeError) return c.json({ error: error.message }, error.status);
        throw error;
      }
    });
    const response = await app.request("/api/__test/a2base-history", {
      headers: { cookie: await baseCookie(f.contributor.sub) },
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "personal_history_unresolved" });
  });
});
