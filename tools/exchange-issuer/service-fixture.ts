import { once } from "node:events";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createRemoteJWKSet, generateKeyPair, jwtVerify } from "jose";
import { createIsolatedIssuer } from "./isolated-issuer.js";
import { createImmoHttpApp } from "../../packages/immo-mcp/src/server-http.js";
import { HttpDataSource } from "../../packages/immo-mcp/src/data-source.js";
import { ExchangeCache, SingleFlightExchange } from "../../packages/immo-mcp/src/exchange-cache.js";
import { signalSearchBody, signalSearchItem } from "../../packages/immo-mcp/src/signal-search-test-fixture.js";
import { signSubjectToken, TEST_ISSUER, TEST_RESOURCE, TEST_API_AUDIENCE, TEST_WORKLOAD_SECRET } from "../../packages/immo-mcp/src/test-exchange-fixtures.js";

export async function serviceFixture() {
  const servers: ReturnType<typeof serve>[] = [];
  async function listen(app: Hono) {
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
    servers.push(server);
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing_listener_address");
    return `http://127.0.0.1:${address.port}`;
  }
  async function close() {
    await Promise.all(servers.map((server) => new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => error ? reject(error) : resolve());
    })));
  }
  try {
    const subject = await generateKeyPair("RS256");
    const issuer = await createIsolatedIssuer({ issuer: TEST_ISSUER, resource: TEST_RESOURCE,
      audience: TEST_API_AUDIENCE, subjectKey: subject.publicKey, workload: "immo-mcp-workload", clientSecret: TEST_WORKLOAD_SECRET });
    const issuerUrl = await listen(issuer.app);
    const radar = new Hono();
    const seen: string[] = [];
    radar.use("/api/*", async (c, next) => {
      const token = (c.req.header("authorization") ?? "").replace(/^Bearer /, "");
      try {
        const { payload } = await jwtVerify(token, issuer.publicKey, { issuer: TEST_ISSUER, audience: TEST_API_AUDIENCE });
        if (payload.sub !== "user-1" || payload.scope !== "immo:search" ||
            (payload.act as { sub?: string })?.sub !== "immo-mcp-workload" || payload.client_id !== "immo-mcp-workload") {
          return c.json({ error: "forbidden" }, 403);
        }
        return await next();
      } catch { return c.json({ error: "unauthorized" }, 401); }
    });
    radar.get("/api/v1/mcp/facets/signals/search", (c) => {
      const city = c.req.query("city") ?? "";
      seen.push((c.req.header("authorization") ?? "").replace(/^Bearer /, ""));
      return c.json(signalSearchBody(city, [signalSearchItem(city, { id: "synthetic-signal" })]));
    });
    const radarUrl = await listen(radar);
    const jwks = createRemoteJWKSet(new URL(`${issuerUrl}/.well-known/jwks.json`));
    const mcp = createImmoHttpApp({ issuer: TEST_ISSUER, resource: TEST_RESOURCE,
      requiredScopes: ["immo:read"], scopesSupported: ["immo:read", "immo:search"], port: 0,
      dataMode: "real", sessionIdleTimeoutMs: 1_800_000, sessionMaxLifetimeMs: 28_800_000,
    }, { keySource: { resolveKey: async () => subject.publicKey }, data: new HttpDataSource({ baseUrl: radarUrl }),
      authorize: async () => true,
      exchange: { clientSecret: TEST_WORKLOAD_SECRET, allowLoopbackHttp: true, config: { issuer: TEST_ISSUER, apiAudience: TEST_API_AUDIENCE, mcpResource: TEST_RESOURCE,
        tokenEndpoint: `${issuerUrl}/token`, workloadSub: "immo-mcp-workload", workloadClientId: "immo-mcp-workload",
        environment: "test-artefacts-mcp-a2", policyRevision: "p4-v1" },
        keySource: { resolveKey: (header) => jwks(header as never, {} as never) },
        cache: new ExchangeCache(), singleFlight: new SingleFlightExchange(),
      } });
    const mcpUrl = await listen(mcp);
    return { issuer, seen, issuerUrl, mcpUrl, radarUrl, close,
      subject: await signSubjectToken(subject.privateKey),
      reduced: await signSubjectToken(subject.privateKey, { scope: "immo:read" }),
      subjectPrivateKey: subject.privateKey,
      issuerPrivateKey: issuer.privateKey,
    };
  } catch (error) { await close(); throw error; }
}
