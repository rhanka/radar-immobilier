/** Integrated production facade; transport failures remain explicit test injections. */
import { createServer } from "node:http";
import { once } from "node:events";
import { exportJWK } from "jose";
import { Hono } from "hono";
import { vi } from "vitest";
import { createApp } from "../../src/app.js";
import { strictReceiverTestAuth, strictReceiverTestConfig } from "../../src/artifacts/strict-receiver.js";
import { MCP_SIGNAL_SEARCH_PATH } from "../../src/routes/mcp-signal-search.js";
import * as signalSearch from "../../src/services/facets/mcp-signal-search.js";
import { privateSignalResponse } from "../../src/services/facets/private-response.js";
import { workspaceFixture, workspaceSignal } from "../../src/services/facets/workspace-archive-fixture.js";
import { EMPTY_DISCARDED_SIGNALS } from "../../src/services/graph/discarded-signals.js";
import type { ObjectStore } from "../../src/storage/object-store.js";
import { createIsolatedExchangeFixture, exchangeDepsFor, signSubjectToken } from "../../../packages/immo-mcp/src/test-exchange-fixtures.js";
import { HttpDataSource } from "../../../packages/immo-mcp/src/data-source.js";
import { createImmoHttpApp, type ImmoHttpDeps } from "../../../packages/immo-mcp/src/server-http.js";
import { accountAuthorizer } from "../../../packages/immo-mcp/src/account-binding.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export async function mcpFixture(options: Pick<ImmoHttpDeps, "authorize"> = {}) {
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
  let reads = 0;
  const originalSearch = signalSearch.searchMcpSignals;
  const business = vi.spyOn(signalSearch, "searchMcpSignals").mockImplementation(async (...args) => {
    reads++;
    return originalSearch(...args);
  });
  const app = createApp({ db: data.db, store, auth, discarded: EMPTY_DISCARDED_SIGNALS,
    mcpSignalSearch: { enabled: true },
    checkDb: async () => ({ ok: true }), checkObjectStore: async () => ({ ok: true }) });
  const receiver = new Hono();
  receiver.use(MCP_SIGNAL_SEARCH_PATH, privateSignalResponse);
  receiver.route("/", app);
  const requests: Request[] = [];
  const upstream: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    if (status) return Response.json({ error, successor: "https://private.invalid/token" }, { status });
    return receiver.request(request);
  };
  const deps = exchangeDepsFor(exchange);
  const mcp = createImmoHttpApp({ issuer: exchange.config.issuer, resource: exchange.config.mcpResource,
    requiredScopes: ["immo:read"], scopesSupported: ["immo:read", "immo:search"], port: 0, dataMode: "real",
    sessionIdleTimeoutMs: 1_800_000, sessionMaxLifetimeMs: 28_800_000 }, {
    keySource: exchange.subjectKeySource, exchange: deps,
    authorize: options.authorize ?? accountAuthorizer(data.pool),
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
      business.mockRestore();
      jwks.closeAllConnections();
      await new Promise<void>((resolve) => jwks.close(() => resolve()));
      // The imported database fixture owns pool shutdown and database removal.
    }
  };
  return { data, signal, connect, close, receiver, mcp, exchange, requests, head, reads: () => reads,
    upstreamError: (nextStatus: number | undefined, nextError = "") => { status = nextStatus; error = nextError; } };
}
export type McpFixture = Awaited<ReturnType<typeof mcpFixture>>;
export async function search(client: Client, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name: "search_signals", arguments: { city: "synthetic-city", ...args } });
  const body = JSON.parse((result.content as { text: string }[])[0]!.text);
  return { result, body };
}
