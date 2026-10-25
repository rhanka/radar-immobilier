import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { writeScopedPersonalFacet } from "../../src/services/facets/scoped-writer.js";
import { networkFixture, networkSearch } from "./mcp-signal-search-network-fixture.js";

describeDb("T14 complete MCP HTTP search through production facade", () => {
  it.each(["serving", "cutover-closed", "retired"] as const)(
    "preserves two humans, sessions and exchanged authority with legacy %s", async (retirement) => {
      const f = await networkFixture(retirement);
      try {
        await writeScopedPersonalFacet(f.data.db, f.data.contributor.sub, f.data.workspaceId,
          { action: "discard", target: f.signal.target, expectedHeadId: null, reasonCode: "N-NON-RES",
            displayedFingerprint: f.signal.fingerprint, commandKey: randomUUID() });
        const alice = await f.connect(), bob = await f.connect(f.data.outsider.sub);
        const renewed = await f.connect(f.data.contributor.sub, "immo:read immo:search immo:documents:read");
        expect((await alice.client.listTools()).tools).toHaveLength(12);
        const results = await Promise.all([networkSearch(alice.client), networkSearch(bob.client),
          networkSearch(renewed.client, { showDiscarded: true })]);
        expect(results.every(({ result }) => result.isError !== true)).toBe(true);
        expect(results[0]!.body.signals).toEqual([]);
        expect(results[1]!.body.signals.map((s: { id: string }) => s.id)).toEqual([f.signal.node.id]);
        expect(results[2]!.body.signals.map((s: { id: string }) => s.id)).toEqual([f.signal.node.id]);
        const reused = await fetch(f.mcpUrl + "/mcp", { method: "POST", headers: {
          authorization: `Bearer ${bob.subject}`, "mcp-session-id": alice.transport.sessionId!,
          "content-type": "application/json", accept: "application/json, text/event-stream",
        }, body: JSON.stringify({ jsonrpc: "2.0", id: 10, method: "tools/list" }) });
        expect(reused.status).toBe(404);
        expect(f.requests).toHaveLength(3);
        for (const request of f.requests) {
          expect(request.path).toBe("/api/v1/mcp/facets/signals/search");
          expect(request.cookie).toBeNull();
          expect(f.exchange.issuedExchangedTokens.map((token) => `Bearer ${token}`)).toContain(request.bearer);
          expect([alice.subject, bob.subject, renewed.subject].map((token) => `Bearer ${token}`)).not.toContain(request.bearer);
        }
        expect(f.exchanges()).toBe(3);
      } finally { await f.close(); }
    });
  it.each(["membership", "approval"])("invalidates warm exchange after current %s revocation", async (kind) => {
    const f = await networkFixture();
    try {
      const { client } = await f.connect();
      expect((await networkSearch(client)).result.isError).not.toBe(true);
      if (kind === "membership") await f.data.pool.query("UPDATE workspace_memberships SET status='revoked', revoked_at=now() WHERE account_id=$1", [f.data.contributor.id]);
      else await f.data.pool.query("UPDATE account_users SET status='suspended' WHERE id=$1", [f.data.contributor.id]);
      const denied = await networkSearch(client);
      expect(denied.result.isError).toBe(true);
      expect(denied.body).toMatchObject({ error: kind === "membership" ? "workspace_missing" : "account_not_approved", upstreamStatus: 403 });
      expect(f.exchanges()).toBe(1);
      expect((await networkSearch(client)).result.isError).toBe(true);
      expect(f.exchanges()).toBe(2);
      expect(f.requests.every((r) => r.path === "/api/v1/mcp/facets/signals/search" && !r.cookie)).toBe(true);
    } finally { await f.close(); }
  });
  it("keeps a warm exchange but refuses a newly closed epoch without empty success", async () => {
    const f = await networkFixture();
    try {
      const { client } = await f.connect();
      expect((await networkSearch(client)).result.isError).not.toBe(true);
      await f.data.pool.query("UPDATE facet_activation_state SET maintenance_barrier=true WHERE workspace_id=$1", [f.data.workspaceId]);
      const denied = await networkSearch(client);
      expect(denied.result.isError).toBe(true);
      expect(denied.body).toMatchObject({ error: "signal_capability_unavailable", upstreamStatus: 503 });
      expect(denied.body).not.toHaveProperty("signals");
      expect(f.exchanges()).toBe(1);
    } finally { await f.close(); }
  });
  it("keeps the default-closed candidate local to search and preserves the twelve-tool list", async () => {
    const f = await networkFixture("retired", false);
    try {
      const { client } = await f.connect();
      expect((await client.listTools()).tools).toHaveLength(12);
      const denied = await networkSearch(client);
      expect(denied.result.isError).toBe(true);
      expect(denied.body).toMatchObject({ error: "signal_capability_unavailable", upstreamStatus: 503 });
    } finally { await f.close(); }
  });
});
