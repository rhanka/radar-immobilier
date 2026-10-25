/** Test-only facade mounting. Production normalization/mounting remain T08/T09. */
import { createServer } from "node:http";
import { once } from "node:events";
import { exportJWK } from "jose";
import { Hono } from "hono";
import { vi } from "vitest";
import { createApp } from "../../src/app.js";
import { strictReceiverTestAuth, strictReceiverTestConfig } from "../../src/artifacts/strict-receiver.js";
import { decodeMcpSignalSearch, MCP_SIGNAL_SEARCH_PATH } from "../../src/routes/mcp-signal-search.js";
import { readMcpSignalCards } from "../../src/services/facets/mcp-signal-search.js";
import { ScopeError } from "../../src/services/facets/scope.js";
import { WorkspaceError } from "../../src/services/workspaces/types.js";
import { privateSignalResponse } from "../../src/services/facets/private-response.js";
import { workspaceFixture, workspaceSignal } from "../../src/services/facets/workspace-archive-fixture.js";
import { EMPTY_DISCARDED_SIGNALS } from "../../src/services/graph/discarded-signals.js";
import type { ObjectStore } from "../../src/storage/object-store.js";
import { createIsolatedExchangeFixture, exchangeDepsFor, signSubjectToken } from "../../../packages/immo-mcp/src/test-exchange-fixtures.js";
import { HttpDataSource } from "../../../packages/immo-mcp/src/data-source.js";
import { createImmoHttpApp } from "../../../packages/immo-mcp/src/server-http.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export async function mcpFixture() {
  const data = await workspaceFixture();
  const signal = await workspaceSignal(data);
  await data.pool.query("UPDATE workspace_memberships SET status='revoked', revoked_at=now() WHERE workspace_id=$1 AND account_id=$2",
    [data.otherId, data.contributor.id]);
  const exchange = await createIsolatedExchangeFixture();
  const jwk = await exportJWK(exchange.exchangePublicKey);
  jwk.alg = "RS256";
  const jwks = createServer((_req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ keys: [jwk] })); });
  jwks.listen(0, "127.0.0.1");
  await once(jwks, "listening");
  const address = jwks.address() as { port: number };
  const auth = { ...strictReceiverTestAuth(strictReceiverTestConfig({ apiAudience: exchange.config.apiAudience })),
    issuer: exchange.config.issuer, jwksUri: `http://127.0.0.1:${address.port}/jwks`,
    strict: { ...strictReceiverTestConfig({ apiAudience: exchange.config.apiAudience }), issuer: exchange.config.issuer } };
  const head = vi.fn(async () => null);
  const store = { head } as unknown as ObjectStore;
  let status: number | undefined;
  let error = "";
  const app = createApp({ db: data.db, store, auth, discarded: EMPTY_DISCARDED_SIGNALS,
    checkDb: async () => ({ ok: true }), checkObjectStore: async () => ({ ok: true }) });
  app.get(MCP_SIGNAL_SEARCH_PATH, async (c) => {
    if (status) return c.json({ error, successor: "https://private.invalid/token" }, status as 503);
    try {
      const args = decodeMcpSignalSearch(new URL(c.req.url).searchParams);
      const sub = (c.get("session" as never) as { sub: string }).sub;
      const result = await readMcpSignalCards({ db: data.db, store }, sub, args);
      // Synthetic cards exercise authority/visibility here; T08 owns real domain normalization.
      const signals = result.cards.map((card) => ({ id: card.id, city: args.city, type: card.type,
        etape: "", regulatoryStatus: card.regulatoryStatus, etape_date: card.publishedAt ?? "",
        reglement_number: "", zone_ref: "", no_lot: null, summary: card.description ?? card.label ?? "",
        source_document_id: card.sourceRef ?? "" })).slice(0, args.limit);
      return c.json({ ok: true, workspaceId: result.workspaceId, citySlug: result.citySlug, signals });
    } catch (failure) {
      if (failure instanceof ScopeError || failure instanceof WorkspaceError) return c.json({ error: failure.message }, failure.status);
      throw failure;
    }
  });
  const receiver = new Hono();
  receiver.use(MCP_SIGNAL_SEARCH_PATH, privateSignalResponse);
  receiver.route("/", app);
  const requests: Request[] = [];
  const upstream: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    return receiver.request(request);
  };
  const deps = exchangeDepsFor(exchange);
  const mcp = createImmoHttpApp({ issuer: exchange.config.issuer, resource: exchange.config.mcpResource,
    requiredScopes: ["immo:read"], scopesSupported: ["immo:read", "immo:search"], port: 0, dataMode: "real",
    sessionIdleTimeoutMs: 1_800_000, sessionMaxLifetimeMs: 28_800_000 }, {
    keySource: exchange.subjectKeySource, exchange: deps,
    data: new HttpDataSource({ baseUrl: exchange.config.apiAudience, fetchImpl: upstream }),
  });
  const clients: { client: Client; transport: StreamableHTTPClientTransport }[] = [];
  const connect = async (sub = data.contributor.sub, scope = "immo:read immo:search") => {
    const subject = await signSubjectToken(exchange.subjectPrivateKey, { sub, scope });
    const transport = new StreamableHTTPClientTransport(new URL(exchange.config.mcpResource), {
      requestInit: { headers: { authorization: `Bearer ${subject}` } }, fetch: async (input, init) => mcp.request(input, init) });
    const client = new Client({ name: "a2base-integration", version: "1" });
    clients.push({ client, transport });
    // SDK Transport declares sessionId optional without explicit undefined.
    await client.connect(transport as Parameters<Client["connect"]>[0]);
    return { client, transport, subject };
  };
  const close = async () => {
    try { for (const { client, transport } of clients) {
      try { await transport.terminateSession(); } finally { await client.close(); }
    } } finally {
      jwks.closeAllConnections();
      await new Promise<void>((resolve) => jwks.close(() => resolve()));
      // The imported database fixture owns pool shutdown and database removal.
    }
  };
  return { data, signal, connect, close, receiver, mcp, exchange, requests, head,
    upstreamError: (nextStatus: number | undefined, nextError = "") => { status = nextStatus; error = nextError; } };
}
export type McpFixture = Awaited<ReturnType<typeof mcpFixture>>;
export async function search(client: Client, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name: "search_signals", arguments: { city: "synthetic-city", ...args } });
  const body = JSON.parse((result.content as { text: string }[])[0]!.text);
  return { result, body };
}
