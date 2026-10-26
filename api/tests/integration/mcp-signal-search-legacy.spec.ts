import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb, workspaceSignal } from "../../src/services/facets/workspace-archive-fixture.js";
import { writeFacet } from "../../src/services/facets/writer.js";
import { McpSignalSearchResponse } from "../../src/routes/mcp-signal-search.js";
import { toMcpSignalResult } from "../../src/services/facets/mcp-signal-result.js";
import { legacyFacadeFixture } from "./mcp-signal-search-legacy-fixture.js";

describeDb("Pre-6H production search facade", () => {
  it.each(["missing", "legacy"] as const)("serves %s epoch without prior activation and matches legacy cards", async (epoch) => {
    const f = await legacyFacadeFixture(epoch);
    expect((await f.data.pool.query("SELECT writer_epoch FROM facet_activation_state")).rows)
      .toEqual(epoch === "missing" ? [] : [{ writer_epoch: "legacy" }]);
    expect((await f.data.pool.query("SELECT * FROM facet_streams")).rowCount).toBe(0);
    const legacy = await f.request("/api/graph-signals/synthetic-city");
    expect(legacy.status).toBe(200);
    const response = await f.search();
    expect(response.status).toBe(200);
    const body = McpSignalSearchResponse.parse(await response.json());
    expect(body.signals).toEqual((await legacy.json()).nodes.map(
      (node: Parameters<typeof toMcpSignalResult>[0]) => toMcpSignalResult(node, "synthetic-city")));
    expect(body.workspaceId).toBe(f.data.workspaceId);
    expect(f.forViewer.mock.calls.map(([sub]) => sub)).toEqual([f.data.contributor.sub, f.data.contributor.sub]);
  });
  it("preserves legacy personal archives, read-only reveal and filters before limit", async () => {
    const f = await legacyFacadeFixture();
    const other = await workspaceSignal(f.data, "Other member archive");
    const late = await workspaceSignal(f.data, "Late filter match");
    for (const [signal, sub] of [[f.signal, f.data.contributor.sub], [other, f.data.moderator.sub]] as const) {
      await writeFacet(f.data.db, sub, { action: "discard", target: signal.target, expectedHeadId: null,
        displayedFingerprint: signal.fingerprint, reasonCode: "N-NON-RES", commandKey: randomUUID() });
    }
    await f.data.pool.query("UPDATE graph_nodes SET source_ref='raw/hidden.pdf' WHERE id=$1", [f.signal.node.id]);
    await f.data.pool.query("UPDATE graph_nodes SET props=$1 WHERE id=$2", [{ properties: {
      etape: "adoption", zone_ref: "LATE-ZONE", regulatoryStatus: "firm" } }, late.node.id]);
    const snapshot = async () => (await f.data.pool.query(`SELECT jsonb_agg(to_jsonb(t) ORDER BY id) AS state
      FROM facet_events t`)).rows;
    const before = await snapshot();
    for (const reveal of [false, true]) {
      const query = reveal ? "?showDiscarded=1" : "";
      const legacy = await f.request("/api/graph-signals/synthetic-city" + query);
      const response = await f.search(reveal ? "&showDiscarded=1" : "");
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.signals).toEqual((await legacy.json()).nodes.map(
        (node: Parameters<typeof toMcpSignalResult>[0]) => toMcpSignalResult(node, "synthetic-city")));
      expect(body.signals.map((s: { id: string }) => s.id).sort()).toEqual(
        (reveal ? [f.signal.node.id, other.node.id, late.node.id] : [other.node.id, late.node.id]).sort());
      if (!reveal) expect(f.head).not.toHaveBeenCalled();
    }
    expect(f.forViewer).toHaveBeenCalledTimes(2);
    expect(f.head).toHaveBeenCalledTimes(2);
    const filtered = await f.search("&etape=adoption&query=LATE-ZONE&limit=1");
    expect((await filtered.json()).signals).toMatchObject([{ id: late.node.id, regulatoryStatus: "firm" }]);
    expect((await (await f.search("&query=absent")).json()).signals).toEqual([]);
    expect(await snapshot()).toEqual(before);
    await f.data.pool.query("DELETE FROM graph_nodes");
    expect((await f.request("/api/graph-signals/synthetic-city")).status).toBe(404);
    expect((await (await f.search("&showDiscarded=1")).json()).signals).toEqual([]);
    expect((await f.data.pool.query("SELECT * FROM facet_activation_state")).rows).toEqual([]);
  });
});
