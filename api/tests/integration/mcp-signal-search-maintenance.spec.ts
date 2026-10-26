import { expect, it, vi } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { ScopeError } from "../../src/services/facets/scope.js";
import { decodeSignalReadError } from "../../../packages/immo-mcp/src/signal-read-error.js";
import { facadeFixture } from "./mcp-signal-search-facade-fixture.js";

describeDb("MCP maintenance barrier projects a retryable cutover", () => {
  it("maps an entry barrier to a retryable cutover without business rows", async () => {
    const f = await facadeFixture();
    await f.data.pool.query("UPDATE facet_activation_state SET maintenance_barrier=true WHERE workspace_id=$1",
      [f.data.workspaceId]);
    const response = await f.search("&showDiscarded=1");
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ error: `scoped_maintenance_in_progress:${f.data.workspaceId}` });
    expect(f.head).not.toHaveBeenCalled();
    const decoded = await decodeSignalReadError(Response.json(body, { status: 503 }));
    expect(decoded.code).toBe("signal_cutover_in_progress");
    expect(decoded.retryable).toBe(true);
    expect(decoded.action).toBe("retry_later");
  });
  it("maps a barrier raised during enrichment to the same retryable cutover", async () => {
    const f = await facadeFixture();
    await f.data.pool.query("UPDATE graph_nodes SET source_ref='raw/synthetic/card.pdf' WHERE id=$1",
      [f.signal.node.id]);
    let flipped = false;
    f.head.mockImplementation(async () => {
      if (!flipped) {
        flipped = true;
        await f.data.pool.query("UPDATE facet_activation_state SET maintenance_barrier=true WHERE workspace_id=$1",
          [f.data.workspaceId]);
      }
      return null;
    });
    const response = await f.search("&showDiscarded=1");
    expect(flipped).toBe(true);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ error: `scoped_maintenance_in_progress:${f.data.workspaceId}` });
    expect(body).not.toHaveProperty("signals");
    const decoded = await decodeSignalReadError(Response.json(body, { status: 503 }));
    expect(decoded.code).toBe("signal_cutover_in_progress");
    expect(decoded.retryable).toBe(true);
    expect(decoded.action).toBe("retry_later");
  });
  it("preserves the maintenance refusal when the barrier reopens before MCP translation", async () => {
    const f = await facadeFixture();
    await f.data.pool.query("UPDATE graph_nodes SET source_ref='raw/synthetic/card.pdf' WHERE id=$1",
      [f.signal.node.id]);
    f.head.mockImplementation(async () => {
      await f.data.pool.query("UPDATE facet_activation_state SET maintenance_barrier=true WHERE workspace_id=$1",
        [f.data.workspaceId]);
      return null;
    });
    const transaction = f.data.db.transaction.bind(f.data.db);
    let refusal: unknown;
    const spy = vi.spyOn(f.data.db, "transaction").mockImplementation(async (...args) => {
      try { return await transaction(...args); }
      catch (error) {
        if (error instanceof ScopeError && error.status === 503) {
          refusal = error;
          // The real BASE transaction has rejected; MCP has not caught it yet.
          await f.data.pool.query("UPDATE facet_activation_state SET maintenance_barrier=false WHERE workspace_id=$1",
            [f.data.workspaceId]);
        }
        throw error;
      }
    });
    let response: Response;
    try { response = await f.search("&showDiscarded=1"); }
    finally { spy.mockRestore(); }
    expect(refusal).toBeInstanceOf(ScopeError);
    expect((await f.data.pool.query("SELECT maintenance_barrier FROM facet_activation_state WHERE workspace_id=$1",
      [f.data.workspaceId])).rows).toEqual([{ maintenance_barrier: false }]);
    expect(response.status).toBe(503);
    const body = await response.json();
    const decoded = await decodeSignalReadError(Response.json(body, { status: response.status }));
    expect(decoded).toMatchObject({ code: "signal_cutover_in_progress", retryable: true, action: "retry_later" });
    expect(body).toEqual({ error: `scoped_maintenance_in_progress:${f.data.workspaceId}` });
  });
});
