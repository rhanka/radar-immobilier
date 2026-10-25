import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { mcpFixture, search } from "./a2base-mcp-fixture.js";

describeDb("T12 exact delegated receiver on createApp/PostgreSQL", () => {
  it("refuses legacy, prefix, encoded, method, duplicate and unknown-query authority", async () => {
    const f = await mcpFixture();
    try {
      const { client } = await f.connect();
      expect((await search(client)).result.isError).not.toBe(true);
      const headers = { authorization: `Bearer ${f.exchange.issuedExchangedTokens[0]}` };
      const path = "/api/v1/mcp/facets/signals/search";
      expect((await f.receiver.request(path + "?city=synthetic-city", {
        headers: { ...headers, accept: "text/event-stream" } })).status).toBe(403);
      for (const [method, route] of [
        ["GET", "/api/graph-signals/synthetic-city"], ["GET", path + "/more?city=synthetic-city"],
        ["GET", "/api/v1/mcp/facets/signals/%73earch?city=synthetic-city"],
        ["POST", path + "?city=synthetic-city"], ["GET", path + "?city=synthetic-city&city=synthetic-city"],
        ["GET", path + "?city=synthetic-city&limit=1&limit=2"], ["GET", path + "?city=synthetic-city&sub=other"],
        ["GET", path + "?city=synthetic-city&showDiscarded=true"], ["GET", path + "?city=synthetic-city&workspaceId=default"],
        ["GET", "/api/v1/workspaces/" + f.data.workspaceId + "/signal-facets/coherent-city?citySlug=synthetic-city&mode=signal"],
      ] as const) {
        const response = await f.receiver.request(route!, { method, headers });
        expect(response.status, `${method} ${route}`).toBe(403);
        expect(await response.json()).toEqual({ error: "delegated_scope_refused" });
      }
    } finally { await f.close(); }
  });
});
