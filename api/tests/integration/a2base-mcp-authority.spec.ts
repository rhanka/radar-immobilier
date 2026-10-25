import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { mcpFixture, search } from "./a2base-mcp-fixture.js";

describeDb("T11 MCP authority and cache over createApp/PostgreSQL", () => {
  it.each(["membership", "approval"])("invalidates a warm exchange after current %s is revoked", async (kind) => {
    const f = await mcpFixture();
    try {
      const { client } = await f.connect();
      expect((await search(client)).body.signals.map((s: { id: string }) => s.id)).toEqual([f.signal.node.id]);
      if (kind === "membership") await f.data.pool.query("UPDATE workspace_memberships SET status='revoked', revoked_at=now() WHERE account_id=$1", [f.data.contributor.id]);
      else await f.data.pool.query("UPDATE account_users SET status='suspended' WHERE id=$1", [f.data.contributor.id]);
      const denied = await search(client);
      expect(denied.result.isError).toBe(true);
      expect(denied.body.error).toBe(kind === "membership" ? "workspace_missing" : "account_not_approved");
      expect(denied.body.upstreamStatus).toBe(403);
      expect(f.exchange.issuedExchangedTokens).toHaveLength(1);
      expect((await search(client)).result.isError).toBe(true);
      expect(f.exchange.issuedExchangedTokens).toHaveLength(2);
      expect(f.requests.every((request) => !request.headers.has("cookie"))).toBe(true);
    } finally { await f.close(); }
  });
  it("keeps two humans and concurrent sessions distinct while refusing cross-session reuse", async () => {
    const f = await mcpFixture();
    try {
      const alice = await f.connect();
      const bob = await f.connect(f.data.outsider.sub);
      const results = await Promise.all([search(alice.client), search(bob.client)]);
      expect(results.every(({ result }) => result.isError !== true)).toBe(true);
      expect(f.exchange.issuedExchangedTokens).toHaveLength(2);
      const seen = f.requests.map((request) => request.headers.get("authorization"));
      expect(new Set(seen).size).toBe(2);
      for (const header of seen) {
        expect(f.exchange.issuedExchangedTokens.map((token) => `Bearer ${token}`)).toContain(header);
        expect(header).not.toBe(`Bearer ${alice.subject}`);
        expect(header).not.toBe(`Bearer ${bob.subject}`);
      }
      const crossed = await f.receiver.request("/api/v1/mcp/facets/signals/search?city=synthetic-city", {
        headers: { authorization: `Bearer ${alice.subject}` } });
      expect(crossed.status).toBe(401);
      expect(crossed.headers.get("cache-control")).toBe("private, no-store");
    } finally { await f.close(); }
  });
});
