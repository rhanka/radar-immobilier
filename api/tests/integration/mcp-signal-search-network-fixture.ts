import { createServer } from "node:http";
import { once } from "node:events";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { exportJWK, jwtVerify } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../../src/app.js";
import { strictReceiverTestAuth, strictReceiverTestConfig } from "../../src/artifacts/strict-receiver.js";
import { workspaceFixture, workspaceSignal } from "../../src/services/facets/workspace-archive-fixture.js";
import { createDiscardedSignalsReader } from "../../src/services/facets/discarded-reader.js";
import { facetActivationState } from "../../src/db/schema.js";
import type { LegacyRetirementState } from "../../src/services/facets/legacy-retirement.js";
import { legacyDataFixture } from "./mcp-signal-search-legacy-fixture.js";
import { networkDocumentStore } from "./mcp-signal-search-network-document.js";
import { HttpDataSource } from "../../../packages/immo-mcp/src/data-source.js";
import { createImmoHttpApp } from "../../../packages/immo-mcp/src/server-http.js";
import { createIsolatedExchangeFixture, exchangeDepsFor, signSubjectToken,
  TEST_TOKEN_ENDPOINT } from "../../../packages/immo-mcp/src/test-exchange-fixtures.js";

async function listen(app: Hono) {
  const server = createServer(getRequestListener((req) => app.fetch(req)));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}

/** All three hops use sockets; no injected business results or local facade mounts. */
export async function networkFixture(retirement: LegacyRetirementState = "retired", enabled = true,
  epoch: "scoped" | "missing" | "legacy" = "scoped") {
  const data = epoch === "scoped" ? await workspaceFixture() : await legacyDataFixture();
  if (epoch === "legacy") await data.db.insert(facetActivationState).values({ workspaceId: data.workspaceId });
  const signal = await workspaceSignal(data);
  await data.pool.query("UPDATE workspace_memberships SET status='revoked', revoked_at=now() WHERE workspace_id=$1 AND account_id=$2",
    [data.otherId, data.contributor.id]);
  const exchange = await createIsolatedExchangeFixture();
  const issuerApp = new Hono(), apiApp = new Hono(), mcpApp = new Hono();
  const listeners: Awaited<ReturnType<typeof listen>>[] = [];
  const clients: { client: Client; transport: StreamableHTTPClientTransport }[] = [];
  let documents: Awaited<ReturnType<typeof networkDocumentStore>> | undefined;
  const close = async () => {
    let failure: unknown;
    for (const { client, transport } of clients) {
      try {
        try { await transport.terminateSession(); } finally { await client.close(); }
      } catch (error) { failure ??= error; }
    }
    for (const { server } of listeners.reverse()) {
      server.closeAllConnections();
      try { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
      catch (error) { failure ??= error; }
    }
    documents?.close();
    if (failure) throw failure;
  };
  try {
    documents = await networkDocumentStore();
    const issuer = await listen(issuerApp); listeners.push(issuer);
    const api = await listen(apiApp); listeners.push(api);
    const mcp = await listen(mcpApp); listeners.push(mcp);
    exchange.config = { ...exchange.config, apiAudience: api.url, mcpResource: mcp.url + "/mcp",
      tokenEndpoint: issuer.url + "/token" };
    const jwk = await exportJWK(exchange.exchangePublicKey);
    jwk.alg = "RS256";
    issuerApp.get("/jwks", (c) => c.json({ keys: [jwk] }));
    let exchanges = 0;
    issuerApp.post("/token", async (c) => {
      const body = await c.req.text();
      await jwtVerify(new URLSearchParams(body).get("subject_token")!, exchange.subjectPublicKey,
        { issuer: exchange.config.issuer, audience: exchange.config.mcpResource });
      exchanges++;
      return exchange.fetchImpl(TEST_TOKEN_ENDPOINT, { method: "POST", body, headers: c.req.raw.headers });
    });
    const strict = { ...strictReceiverTestConfig({ apiAudience: api.url }), issuer: exchange.config.issuer,
      mcpAudience: exchange.config.mcpResource };
    const auth = { ...strictReceiverTestAuth(strict), issuer: exchange.config.issuer,
      jwksUri: issuer.url + "/jwks", strict };
    const requests: { path: string; bearer: string | null; cookie: string | null }[] = [];
    apiApp.use("*", async (c, next) => {
      requests.push({ path: new URL(c.req.url).pathname, bearer: c.req.header("authorization") ?? null,
        cookie: c.req.header("cookie") ?? null });
      await next();
    });
    apiApp.route("/", createApp({ db: data.db, store: documents.store,
      auth, discarded: createDiscardedSignalsReader(data.db), checkDb: async () => ({ ok: true }),
      checkObjectStore: async () => ({ ok: true }), legacyRetirement: retirement,
      mcpSignalSearch: { enabled } }));
    const exchangeDeps = exchangeDepsFor(exchange, { fetchImpl: fetch, allowLoopbackHttp: true });
    mcpApp.route("/", createImmoHttpApp({ issuer: exchange.config.issuer, resource: exchange.config.mcpResource,
      requiredScopes: ["immo:read"], scopesSupported: ["immo:read", "immo:search"], port: 0, dataMode: "real",
      sessionIdleTimeoutMs: 1_800_000, sessionMaxLifetimeMs: 28_800_000 }, {
      keySource: exchange.subjectKeySource, exchange: exchangeDeps,
      data: new HttpDataSource({ baseUrl: api.url }),
    }));
    const connect = async (sub = data.contributor.sub, scope = "immo:read immo:search") => {
      const subject = await signSubjectToken(exchange.subjectPrivateKey,
        { sub, scope, audience: exchange.config.mcpResource });
      const transport = new StreamableHTTPClientTransport(new URL(exchange.config.mcpResource), {
        requestInit: { headers: { authorization: `Bearer ${subject}` } } });
      const client = new Client({ name: "a2base-network", version: "1" });
      clients.push({ client, transport });
      await client.connect(transport as Parameters<Client["connect"]>[0]);
      return { client, transport, subject };
    };
    return { data, signal, documents, connect, close, requests, exchange, apiUrl: api.url, mcpUrl: mcp.url,
      exchanges: () => exchanges };
  } catch (error) { await close(); throw error; }
}

export async function networkSearch(client: Client, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name: "search_signals", arguments: { city: "synthetic-city", ...args } });
  return { result, body: JSON.parse((result.content as { text: string }[])[0]!.text) };
}
