import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { MCP_SIGNAL_SEARCH_PATH } from "../../src/routes/mcp-signal-search.js";
import { toMcpSignalResult } from "../../src/services/facets/mcp-signal-result.js";
import { describeDb, workspaceSignal } from "../../src/services/facets/workspace-archive-fixture.js";
import { unresolvedRevisionFixture } from "../../src/services/facets/projection-revisions-fixture.js";
import { initializeWorkspaceStore } from "../../src/services/workspaces/init-store.js";
import { facetActivationState } from "../../src/db/schema.js";
import type { ObjectStore } from "../../src/storage/object-store.js";
import { baseAuth, baseCookie } from "./base-api-fixture.js";
import { facadeFixture } from "./mcp-signal-search-facade-fixture.js";

describeDb("T13 production facade cutover states", () => {
  it("finds a late matching card before applying the requested limit", async () => {
    const f = await facadeFixture();
    for (let i = 0; i < 3; i++) await workspaceSignal(f.data, `Nonmatching ${i}`);
    const population = (await (await f.search()).json()).signals;
    const late = population.at(-1).id;
    await f.data.pool.query("UPDATE graph_nodes SET props=$1 WHERE id=$2", [{ properties: {
      etape: "adoption", zone_ref: "LATE-ZONE", regulatoryStatus: "firm" } }, late]);
    const response = await f.search("&limit=1&etape=adoption&query=LATE-ZONE");
    expect(response.status).toBe(200);
    expect((await response.json()).signals).toMatchObject([{ id: late, regulatoryStatus: "firm", zone_ref: "LATE-ZONE" }]);
  });
  it.each(["serving", "cutover-closed", "retired"] as const)(
    "keeps scoped search independent of legacy %s and preserves canonical domain parity", async (retirement) => {
      const f = await facadeFixture({ retirement });
      await f.data.pool.query(`UPDATE graph_nodes SET label='Fallback label', source_ref='raw/evidence.pdf',
        props=$1 WHERE id=$2`, [{ properties: { category: "derogation_mineure", etape: "adoption",
        etape_date: "2026-09-01", regulatoryStatus: "firm", description: "Evidence description",
        reglement_number: "123", zone_ref: "H-1", no_lot: "42" } }, f.signal.node.id]);
      const response = await f.search("&etape=adoption&query=H-1&limit=1");
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.signals).toHaveLength(1);
      expect(body.signals[0]).toMatchObject({ id: f.signal.node.id, type: "derogation_mineure",
        regulatoryStatus: "firm", etape_date: "2026-09-01", reglement_number: "123", zone_ref: "H-1",
        no_lot: "42", summary: "Evidence description", source_document_id: "raw/evidence.pdf" });
      const legacy = await f.request("/api/graph-signals/synthetic-city");
      expect(legacy.status).toBe(retirement === "serving" ? 200 : retirement === "cutover-closed" ? 503 : 410);
      if (retirement === "serving") {
        const original = await legacy.json();
        expect(body.signals).toEqual(original.nodes.map((node: Parameters<typeof toMcpSignalResult>[0]) =>
          toMcpSignalResult(node, "synthetic-city")));
      } else expect((await legacy.json()).error).toBe(retirement === "retired" ? "legacy_retired" : "legacy_cutover_closed");
    });
  it.each(["missing", "legacy", "barrier"])("refuses %s epoch before an empty reveal", async (state) => {
    const f = await facadeFixture();
    let workspaceId = f.data.workspaceId;
    if (state !== "barrier") {
      const created = await initializeWorkspaceStore(f.data.db, { workspaceSlug: `synthetic-${randomUUID()}`,
        workspaceLabel: "Unactivated search", approvedAccountIds: [f.data.moderator.id, f.data.contributor.id],
        managerAccountIds: [f.data.moderator.id], moderatorAccountIds: [], actorAccountId: f.data.moderator.id,
        reason: "synthetic closed scope" });
      workspaceId = created.workspaceId;
      await f.memberships([workspaceId]);
      if (state === "legacy") await f.data.db.insert(facetActivationState).values({ workspaceId });
    } else await f.data.pool.query("UPDATE facet_activation_state SET maintenance_barrier=true WHERE workspace_id=$1", [workspaceId]);
    await f.data.pool.query("DELETE FROM graph_nodes");
    const response = await f.search("&showDiscarded=1");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: `scoped_facet_scope_unavailable:${workspaceId}` });
    expect(f.head).not.toHaveBeenCalled();
  });
  it("refuses unresolved history on the production facade without an empty success", async () => {
    const f = await unresolvedRevisionFixture();
    const app = createApp({ db: f.db, store: {} as ObjectStore, auth: baseAuth,
      checkDb: async () => ({ ok: true }), checkObjectStore: async () => ({ ok: true }),
      mcpSignalSearch: { enabled: true } });
    const response = await app.request(MCP_SIGNAL_SEARCH_PATH + "?city=empty-city&showDiscarded=1", {
      headers: { cookie: await baseCookie(f.contributor.sub) } });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "personal_history_unresolved" });
  });
});
