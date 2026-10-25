import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { writeScopedPersonalFacet } from "../../src/services/facets/scoped-writer.js";
import { writeFacet } from "../../src/services/facets/writer.js";
import { targetFingerprint } from "../../src/services/facets/target.js";
import { networkFixture, networkSearch } from "./mcp-signal-search-network-fixture.js";

describeDb("T14 complete MCP HTTP search through production facade", () => {
  it.each(["missing", "legacy", "scoped"] as const)(
    "returns stored documentary metadata and current human visibility with %s epoch", async (epoch) => {
      const f = await networkFixture(epoch === "scoped" ? "retired" : "serving", true, epoch);
      try {
        const document = await f.documents.seed();
        const props = { refs: [{ rawRef: document.storageKey }], properties: { etape: "adoption", zone_ref: "DOC-ZONE" } };
        await f.data.pool.query("UPDATE graph_nodes SET props=$1 WHERE id=$2", [props, f.signal.node.id]);
        const fingerprint = targetFingerprint({ ...f.signal.node, props });
        const alice = await f.connect(), bob = await f.connect(f.data.outsider.sub);
        const search = await networkSearch(alice.client, { etape: "adoption", query: "DOC-ZONE", limit: 1 });
        expect(search.result.isError).not.toBe(true);
        // Neither date nor docSha is in the graph: both must come from stored metadata.
        expect(search.body.signals).toMatchObject([{ id: f.signal.node.id,
          etape_date: document.publishedAt, source_document_id: document.sha256 }]);
        const command = { action: "discard" as const, target: f.signal.target, expectedHeadId: null,
          displayedFingerprint: fingerprint, reasonCode: "N-NON-RES", commandKey: randomUUID() };
        if (epoch === "scoped") await writeScopedPersonalFacet(f.data.db, f.data.contributor.sub, f.data.workspaceId, command);
        else await writeFacet(f.data.db, f.data.contributor.sub, command);
        expect((await networkSearch(alice.client)).body.signals).toEqual([]);
        expect((await networkSearch(bob.client)).body.signals).toMatchObject([{ source_document_id: document.sha256 }]);
        expect((await networkSearch(alice.client, { showDiscarded: true })).body.signals)
          .toMatchObject([{ etape_date: "2026-09-22", source_document_id: document.sha256 }]);
        if (epoch !== "scoped") {
          expect((await f.data.pool.query("SELECT writer_epoch FROM facet_activation_state")).rows)
            .toEqual(epoch === "missing" ? [] : [{ writer_epoch: "legacy" }]);
          expect((await f.data.pool.query("SELECT * FROM facet_streams")).rowCount).toBe(0);
        }
        await f.data.pool.query("UPDATE workspace_memberships SET status='revoked', revoked_at=now() WHERE account_id=$1", [f.data.contributor.id]);
        const denied = await networkSearch(alice.client, { showDiscarded: true });
        expect(denied.result.isError).toBe(true);
        expect(denied.body).toMatchObject({ error: "workspace_missing", upstreamStatus: 403 });
        expect(f.requests).toHaveLength(5);
        expect(f.requests.every((r) => r.path === "/api/v1/mcp/facets/signals/search" && !r.cookie)).toBe(true);
      } finally { await f.close(); }
    });
  it("keeps original-bearer and exact-route refusals private on the real receiver", async () => {
    const f = await networkFixture();
    try {
      const { client, subject } = await f.connect();
      expect((await networkSearch(client)).result.isError).not.toBe(true);
      const path = "/api/v1/mcp/facets/signals/search";
      const original = await fetch(f.apiUrl + path + "?city=synthetic-city", {
        headers: { authorization: `Bearer ${subject}` } });
      expect(original.status).toBe(401);
      expect(original.headers.get("cache-control")).toBe("private, no-store");
      for (const [method, route] of [["POST", path], ["GET", path + "/more"],
        ["GET", path.replace("search", "%73earch")], ["GET", path + "?city=x&city=y"],
        ["GET", path + "?city=synthetic-city&sub=other"]] as const) {
        const response = await fetch(f.apiUrl + route, { method, headers: {
          authorization: `Bearer ${f.exchange.issuedExchangedTokens[0]}` } });
        expect(response.status).toBe(403);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(await response.json()).toEqual({ error: "delegated_scope_refused" });
      }
    } finally { await f.close(); }
  });
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
