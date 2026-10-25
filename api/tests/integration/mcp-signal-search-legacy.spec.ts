import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
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
});
