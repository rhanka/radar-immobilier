import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { mcpFixture, search } from "./a2base-mcp-fixture.js";

describeDb("T02/T10 typed MCP failures through createApp and PostgreSQL", () => {
  it.each([
    [503, "legacy_cutover_closed", "signal_cutover_in_progress", true],
    [410, "legacy_retired", "signal_route_retired", false],
    [404, "no_signal_nodes", "signal_endpoint_unavailable", false],
    [200, "invalid_envelope", "radar_api_bad_payload", false],
  ] as const)("preserves %s as %s without empty success", async (status, upstream, code, retryable) => {
    const f = await mcpFixture();
    try {
      const { client } = await f.connect();
      f.upstreamError(status, upstream);
      const { result, body } = await search(client);
      expect(result.isError).toBe(true);
      expect(body).toMatchObject({ error: code, retryable, upstreamStatus: status, tool: "search_signals" });
      expect(body.correlationId).toMatch(/^[a-f0-9-]{36}$/);
      expect(JSON.stringify(body)).not.toMatch(/private.invalid|token|successor/);
      expect(f.requests).toHaveLength(1);
      expect(new URL(f.requests[0]!.url).pathname).toBe("/api/v1/mcp/facets/signals/search");
      expect(f.exchange.issuedExchangedTokens).toHaveLength(1);
      if (status !== 200) {
        f.upstreamError(undefined);
        expect((await search(client)).result.isError).not.toBe(true);
        expect(f.exchange.issuedExchangedTokens).toHaveLength(1);
      }
    } finally { await f.close(); }
  });
  it("keeps coarse and tool scopes unchanged and performs no exchange on missing search scope", async () => {
    const f = await mcpFixture();
    try {
      const { client } = await f.connect(f.data.contributor.sub, "immo:read");
      const { result, body } = await search(client);
      expect(result.isError).toBe(true);
      expect(body.error).toMatch(/^scope_denied:immo:search/);
      expect(f.requests).toHaveLength(0);
      expect(f.exchange.issuedExchangedTokens).toHaveLength(0);
      expect((await client.listTools()).tools).toHaveLength(12);
    } finally { await f.close(); }
  });
});
