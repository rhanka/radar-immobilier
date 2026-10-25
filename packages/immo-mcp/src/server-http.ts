#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import type { Context } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpAuth } from "@sentropic/mcp-auth";
import type { McpAuthConfig, McpAuthContext } from "@sentropic/mcp-auth";
import { getMcpAuthContext, mcpAuthRoutes, requireMcpAuth } from "@sentropic/mcp-auth/hono";
import { fromRemoteJwks } from "@sentropic/oauth-verify";
import type { AccessTokenClaims, TokenKeySource } from "@sentropic/oauth-verify";
import { IMMO_SCOPES, type ImmoMcpAuthContext } from "./auth-context.js";
import { bindExchangeInput, buildExchangeInput, runWithExchangeDeps, runWithHttpTransport, type ExchangeRuntimeDeps } from "./authorized-egress.js";
import {
  captureInvocationContext,
  runWithInvocationContext,
  type InvocationContext,
} from "./invocation-context.js";
import { loadExchangeConfig } from "./exchange-config.js";
import { ExchangeCache, SingleFlightExchange } from "./exchange-cache.js";
import type { ExchangeKeySource } from "./exchange-token.js";
import { createDataSource, type ImmoDataSource } from "./data-source.js";
import { createRawDataSource, type RawDataSource } from "./raw-data.js";
import { IMMO_MCP_NAME, IMMO_MCP_VERSION } from "./meta.js";
import { ImmoStatefulHost } from "./stateful-host.js";
import { composeStatefulImmo } from "./registry/stateful-composition.js";
import type { VerifiedMcpRequest } from "@sentropic/cluster-mesh/compose/mcp-stateful";
import { createAccountBinding } from "./account-binding.js";

/**
 * REMOTE transport for the immo MCP provider: Streamable HTTP (MCP SDK) behind an
 * OAuth 2.1 Resource Server (RFC 9728 PRM + RFC 6750 challenges) implemented by the
 * PUBLISHED packages @sentropic/mcp-auth (+ @sentropic/oauth-verify).
 *
 * Both transports compile the same twelve-tool stateful bridge and invoke the
 * shared native handlers. Identity constants live in the side-effect-free
 * `meta.ts`; importing the stdio entrypoint here would execute its bin guard
 * after bundling. The authority sources differ:
 *   - stdio  → `resolveAuthContext(env)` confined to synthetic fixture data
 *   - http   → claims of a validated bearer token (this file's `authContextFromMcp`).
 *
 * Domain data: `search_signals` is WIRED to the real radar API (the same
 * `GET /api/graph-signals/:city` feed the web app reads) when RADAR_API_BASE_URL
 * is set — so the MCP and the app serve the SAME signals (D12). The other v0
 * domain tools (lots/opportunities/documents) remain `not_wired_yet`. The
 * RAW-DATA seam (raw-data.ts — zones/lots GeoJSON, grille & PV PDFs) is likewise
 * wired to the real radar API when RADAR_API_BASE_URL is set.
 */

const DEFAULT_SUPPORTED_SCOPES = `${IMMO_SCOPES.read} ${IMMO_SCOPES.search} ${IMMO_SCOPES.documentsRead}`;
const DEFAULT_HTTP_PORT = 8848;
/** Default idle expiry: a session without any request for 30 minutes is closed. */
export const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
/** Default absolute cap: a session never outlives 8 hours, however active. */
export const DEFAULT_SESSION_MAX_LIFETIME_MS = 8 * 60 * 60 * 1000;

/** Resolved remote-server configuration (all secrets/URLs come from env). */
export interface ImmoHttpConfig {
  /** OAuth authorization server / IdP issuer (PRM `authorization_servers[0]`). */
  issuer: string;
  /** Canonical resource URI = the token audience (RFC 9728 `resource`). */
  resource: string;
  /** Optional explicit JWKS URI; default = `<issuer>/.well-known/jwks.json`. */
  jwksUri?: string;
  /** Coarse scope gate enforced on the `/mcp` route (per-tool gating still applies). */
  requiredScopes: string[];
  /** Scopes advertised in the PRM document. */
  scopesSupported: string[];
  /** Listen port for the standalone entrypoint. */
  port: number;
  /** Mirrors the data source mode → `AuthContext.dataMode`. */
  dataMode: "real" | "simulation";
  /** Idle expiry of an MCP session (ms). */
  sessionIdleTimeoutMs: number;
  /** Absolute maximum lifetime of an MCP session (ms). */
  sessionMaxLifetimeMs: number;
}

/** Parse a positive millisecond duration, falling back to `fallback` when absent/invalid. */
function parseDurationMs(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Build the remote config from env, failing fast on the two mandatory URLs. */
export function loadHttpConfig(env: NodeJS.ProcessEnv): ImmoHttpConfig {
  const issuer = env.IMMO_MCP_OAUTH_ISSUER;
  const resource = env.IMMO_MCP_OAUTH_RESOURCE;
  if (!issuer) {
    throw new Error(
      "config_error: IMMO_MCP_OAUTH_ISSUER is required (OAuth authorization server / IdP issuer)",
    );
  }
  if (!resource) {
    throw new Error(
      "config_error: IMMO_MCP_OAUTH_RESOURCE is required (canonical resource URI = token audience)",
    );
  }
  const splitScopes = (value: string): string[] => value.split(/\s+/).map((s) => s.trim()).filter(Boolean);
  const config: ImmoHttpConfig = {
    issuer,
    resource,
    requiredScopes: splitScopes(env.IMMO_MCP_OAUTH_REQUIRED_SCOPE ?? IMMO_SCOPES.read),
    scopesSupported: splitScopes(env.IMMO_MCP_OAUTH_SCOPES_SUPPORTED ?? DEFAULT_SUPPORTED_SCOPES),
    port: Number(env.IMMO_MCP_HTTP_PORT ?? DEFAULT_HTTP_PORT),
    dataMode: env.IMMO_MCP_DATA_MODE === "http" ? "real" : "simulation",
    sessionIdleTimeoutMs: parseDurationMs(
      env.IMMO_MCP_SESSION_IDLE_TIMEOUT_MS,
      DEFAULT_SESSION_IDLE_TIMEOUT_MS,
    ),
    sessionMaxLifetimeMs: parseDurationMs(
      env.IMMO_MCP_SESSION_MAX_LIFETIME_MS,
      DEFAULT_SESSION_MAX_LIFETIME_MS,
    ),
  };
  if (env.IMMO_MCP_OAUTH_JWKS_URI) config.jwksUri = env.IMMO_MCP_OAUTH_JWKS_URI;
  return config;
}

function asStringArray(value: unknown): string[] | null {
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) return value as string[];
  if (typeof value === "string") return value.split(/\s+/).map((s) => s.trim()).filter(Boolean);
  return null;
}

/**
 * Map a verified OAuth/MCP authorization context to the immo `AuthContext` the tools
 * read. EVERY field comes from validated claims, NEVER from tool arguments — this is
 * the HTTP-mode equivalent of `resolveAuthContext(env)` for stdio.
 */
export function authContextFromMcp(
  mcpAuth: McpAuthContext,
  opts: { audience: string; dataMode: "real" | "simulation" },
): ImmoMcpAuthContext {
  const claims: AccessTokenClaims = mcpAuth.claims;
  const ctx: ImmoMcpAuthContext = {
    sub: mcpAuth.sub,
    userId: mcpAuth.sub,
    tenantId: mcpAuth.tid ?? "radar",
    roles: asStringArray(claims["roles"]) ?? ["viewer"],
    scopes: mcpAuth.scopes,
    workspaces: asStringArray(claims["workspaces"]) ?? ["default"],
    dataMode: opts.dataMode,
    audience: opts.audience,
  };
  const orgId = claims["org_id"];
  if (typeof orgId === "string") ctx.orgId = orgId;
  // The subject credential stays in the private exchange boundary.
  return ctx;
}

/** Extract the raw bearer token from an `Authorization: Bearer <token>` header. */
export function extractBearerToken(header: string | undefined | null): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : undefined;
}

/** Identity a session is bound to at `initialize` time. */
interface SessionOwner {
  /** Token subject — always bound. */
  sub: string;
  /** OAuth client (`azp`, falling back to `client_id`) — bound when the auth context exposes it. */
  clientId?: string | undefined;
}

interface SessionEntry {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
  owner: SessionOwner;
  createdAt: number;
  lastSeenAt: number;
}

const sessionStores = new WeakMap<Hono, Map<string, SessionEntry>>();

/** Number of live MCP sessions held by an app built with `createImmoHttpApp`. */
export function getMcpSessionCount(app: Hono): number {
  return sessionStores.get(app)?.size ?? 0;
}

/** Read the OAuth client identity from verified claims (`azp`, else `client_id`). */
function ownerClientId(mcpAuth: McpAuthContext): string | undefined {
  const claims = mcpAuth.claims as Record<string, unknown>;
  const raw = claims["azp"] ?? claims["client_id"];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function sessionOwnerFromMcp(mcpAuth: McpAuthContext): SessionOwner {
  const owner: SessionOwner = { sub: mcpAuth.sub };
  const clientId = ownerClientId(mcpAuth);
  if (clientId !== undefined) owner.clientId = clientId;
  return owner;
}

/**
 * True when the current request identity matches the session owner. The `sub`
 * must always match; client presence and value must remain identical. A
 * refreshed token keeps the session only under that same owner binding.
 */
function isSessionOwner(owner: SessionOwner, mcpAuth: McpAuthContext): boolean {
  if (mcpAuth.sub !== owner.sub) return false;
  const currentClientId = ownerClientId(mcpAuth);
  if (
    currentClientId !== owner.clientId
  ) {
    return false;
  }
  return true;
}

/** Test/wiring overrides — keeps the prod path env-only while letting tests inject a key source. */
export interface ImmoHttpDeps {
  /** Trusted shared-service binding. No environment value can fabricate this capability. */
  artifacts?: import("./registry/artifact-provider.js").ArtifactMcpBinding;
  /** Override the data source (default = `createDataSource({})` → MockDataSource). */
  data?: ImmoDataSource;
  /**
   * Override the raw-data source (default = `createRawDataSource({})` →
   * MockRawDataSource). `main()` passes the env-derived source so the
   * deployed pod reaches the radar API when RADAR_API_BASE_URL is set.
   */
  raw?: RawDataSource;
  /** Override the token key source (default = remote JWKS off the issuer/jwksUri). */
  keySource?: TokenKeySource;
  /** Clock for session timestamps (default = `Date.now`; injectable for tests). */
  clock?: () => number;
  /** Private request-bound exchange runtime; missing configuration fails closed. */
  exchange?: ExchangeRuntimeDeps | undefined;
  /** Trusted current account/membership port; real data without a binding stays closed. */
  authorize?: (tool: string, request: VerifiedMcpRequest) => Promise<boolean>;
}

/**
 * Build the Hono app exposing:
 *   - GET  /mcp/.well-known/oauth-protected-resource  → RFC 9728 PRM (public)
 *   - GET  /.well-known/oauth-protected-resource/mcp  → canonical PRM (public)
 *   - *    /mcp                                        → OAuth RS guard (401/403 + WWW-Authenticate)
 *   - POST/GET/DELETE /mcp                             → MCP Streamable HTTP transport (stateful)
 */
export function createImmoHttpApp(config: ImmoHttpConfig, deps: ImmoHttpDeps = {}): Hono {
  const data = deps.data ?? createDataSource({});
  const raw = deps.raw ?? createRawDataSource({});

  const mcpAuthConfig: McpAuthConfig = {
    resource: config.resource,
    authorizationServers: [config.issuer],
    scopesSupported: config.scopesSupported,
  };
  if (deps.keySource) mcpAuthConfig.keySource = deps.keySource;
  else if (config.jwksUri) mcpAuthConfig.keySource = fromRemoteJwks(config.jwksUri);
  const mcp = createMcpAuth(mcpAuthConfig);

  const app = new Hono();
  const host = new ImmoStatefulHost(app);
  const ready = composeStatefulImmo(host, deps.authorize ?? (async () => !deps.artifacts && data.mode !== "http" && raw.mode !== "http"), deps.artifacts)
    .then(() => true, () => false);

  // Preserve the historical discovery URL while 0.2 challenges advertise RFC 9728.
  app.get("/mcp/.well-known/oauth-protected-resource", (c) => c.json(mcp.metadata(), 200, {
    "Cache-Control": "public, max-age=300",
  }));
  app.route("/", mcpAuthRoutes(mcp));

  // OAuth Resource Server guard: validates the bearer (issuer/audience/scope), or returns
  // 401/403 with the proper WWW-Authenticate (resource_metadata + scope) challenge.
  app.use("/mcp", requireMcpAuth(mcp, { requiredScopes: config.requiredScopes }));
  app.use("/mcp", async (c, next) => {
    if (!await ready) return c.json({ error: "composition_unavailable" }, 503);
    return await next();
  });

  const sessions = new Map<string, SessionEntry>();
  sessionStores.set(app, sessions);
  const clock = deps.clock ?? (() => Date.now());

  const jsonRpcError = (c: Context, status: 400 | 404, message: string): Response =>
    c.json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }, status);

  // The same "unknown session" response is returned for unknown ids, expired
  // sessions AND owner mismatches, so a rejected request reveals nothing about
  // which case applied.
  const unknownSession = (c: Context): Response =>
    jsonRpcError(c, 404, "Unknown or expired MCP session");

  const currentAuth = (c: Context): { mcpAuth: McpAuthContext; auth: ImmoMcpAuthContext; subjectToken: string | undefined } => {
    const mcpAuth = getMcpAuthContext(c);
    // Identity and scopes come from the CURRENT request (verified
    // upstream by the resource server guard): tools act per-request (D4), so a
    // refreshed token or a removed scope applies to the very next request.
    const auth = authContextFromMcp(mcpAuth, {
      audience: config.resource,
      dataMode: data.mode === "http" ? "real" : "simulation",
    });
    return { mcpAuth, auth, subjectToken: extractBearerToken(c.req.header("authorization")) };
  };

  const dispatchWithExchange = <T>(mcpAuth: McpAuthContext, auth: ImmoMcpAuthContext, subjectToken: string | undefined, snapshot: InvocationContext, fn: () => Promise<T>, signal: AbortSignal): Promise<T> => {
    const clientId = ownerClientId(mcpAuth);
    const authority: VerifiedMcpRequest = {
      principal: { issuer: config.issuer, sub: snapshot.auth.sub, scopes: snapshot.auth.scopes,
        claims: [], attributes: { workspaces: snapshot.auth.workspaces }, ...(clientId === undefined ? {} : { clientId }) },
      resource: config.resource, correlationId: randomUUID(), signal,
    };
    const dispatch = () => runWithInvocationContext(snapshot, () => host.run(authority, fn));
    return runWithHttpTransport(() => {
      if (subjectToken) {
        const claims = mcpAuth.claims as unknown as Record<string, unknown>;
        const exp = claims["exp"];
        const jti = claims["jti"];
        bindExchangeInput(snapshot, buildExchangeInput({
          subjectToken,
          subjectSub: mcpAuth.sub,
          subjectExp: typeof exp === "number" && Number.isFinite(exp) ? Math.floor(exp) : 0,
          subjectScopes: [...mcpAuth.scopes],
          subjectJti: typeof jti === "string" && jti.length > 0 ? jti : undefined,
          subjectClientId: ownerClientId(mcpAuth),
          issuer: config.issuer,
          membership: `${auth.tenantId}:${[...auth.workspaces].sort().join(",")}`,
          confirmation: claims["cnf"] !== undefined ? "cnf" : "none",
        }));
      }
      if (deps.exchange) {
        return runWithExchangeDeps(deps.exchange, dispatch);
      }
      return dispatch();
    });
  };

  const closeSession = async (sessionId: string, entry: SessionEntry): Promise<void> => {
    sessions.delete(sessionId);
    host.forget(entry.server.server);
    try {
      await entry.transport.close();
    } catch {
      // Already closed — the map entry above is what frees the memory.
    }
  };

  const isExpired = (entry: SessionEntry, now: number): boolean =>
    now - entry.lastSeenAt > config.sessionIdleTimeoutMs ||
    now - entry.createdAt > config.sessionMaxLifetimeMs;

  const sweepExpiredSessions = async (now: number): Promise<void> => {
    for (const [id, entry] of sessions) {
      if (isExpired(entry, now)) await closeSession(id, entry);
    }
  };

  const handleMcp = async (c: Context): Promise<Response> => {
    let request: Request;
    try { request = await host.boundRequest(c.req.raw); }
    catch { return c.json({ error: "invalid_request" }, 413); }
    const sessionId = c.req.header("mcp-session-id");

    if (sessionId) {
      const entry = sessions.get(sessionId);
      if (!entry) return unknownSession(c);
      const now = clock();
      if (isExpired(entry, now)) {
        await closeSession(sessionId, entry);
        return unknownSession(c);
      }
      const { mcpAuth, auth, subjectToken } = currentAuth(c);
      // Owner mismatch: reject WITHOUT touching the transport, with the exact
      // unknown-session response.
      if (!isSessionOwner(entry.owner, mcpAuth)) return unknownSession(c);
      entry.lastSeenAt = now;
      // Immutable capture at entry: the running handler keeps this request's
      // identity even when a concurrent request enters the same session.
      const snapshot = captureInvocationContext({ auth, data, raw });
      return dispatchWithExchange(mcpAuth, auth, subjectToken, snapshot, () => entry.transport.handleRequest(request), request.signal);
    }

    // No session yet: only a POST (the `initialize` request) may open one.
    if (c.req.method !== "POST") return jsonRpcError(c, 400, "Missing mcp-session-id header");

    // Expired sessions that never receive another request are freed here.
    await sweepExpiredSessions(clock());

    // The session is bound to the opening request's identity; later requests
    // capture identity and scopes per request; the subject bearer stays private
    // before reaching the transport (see the session branch above).
    const { mcpAuth: openAuth, auth: openAuthCtx, subjectToken: openSubject } = currentAuth(c);
    const snapshotForOpen = captureInvocationContext({ auth: openAuthCtx, data, raw });
    const server = new McpServer({ name: IMMO_MCP_NAME, version: IMMO_MCP_VERSION });
    host.retain(server.server);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
    });
    transport.onclose = () => {
      host.forget(server.server);
      const sid = transport.sessionId;
      if (sid) sessions.delete(sid);
    };
    await server.connect(transport);
    const response = await dispatchWithExchange(openAuth, openAuthCtx, openSubject, snapshotForOpen, () =>
      transport.handleRequest(request), request.signal,
    );
    if (transport.sessionId) {
      const now = clock();
      sessions.set(transport.sessionId, {
        transport,
        server,
        owner: sessionOwnerFromMcp(openAuth),
        createdAt: now,
        lastSeenAt: now,
      });
    } else {
      host.forget(server.server);
      await server.close();
    }
    return response;
  };

  app.on(["POST", "GET", "DELETE"], "/mcp", handleMcp);

  return app;
}

async function main(): Promise<void> {
  const config = loadHttpConfig(process.env);
  // BOTH seams are env-wired from the REAL process env (in-cluster:
  // RADAR_API_BASE_URL=http://radar-api:3000). The domain source now serves REAL
  // signals through search_signals (createDataSource keys off RADAR_API_BASE_URL,
  // same var as the raw seam); the raw seam serves REAL zones/lots/PDF URLs.
  // Passing `data` explicitly is REQUIRED: createImmoHttpApp's default is the
  // env-less mock (createDataSource({})), which was the wiring that pinned prod
  // to mock signals.
  const data = createDataSource(process.env);
  const raw = createRawDataSource(process.env);
  const exchangeConfig = loadExchangeConfig(process.env);
  let exchange: ExchangeRuntimeDeps | undefined;
  const clientSecret = process.env.IMMO_MCP_WORKLOAD_CLIENT_SECRET;
  if (exchangeConfig && clientSecret) {
    const exchangeJwksUri = process.env.IMMO_MCP_EXCHANGE_JWKS_URI ?? `${exchangeConfig.issuer.replace(/\/$/, "")}/.well-known/jwks.json`;
    exchange = {
      config: exchangeConfig,
      clientSecret,
      keySource: fromRemoteJwks(exchangeJwksUri) as unknown as ExchangeKeySource,
      cache: new ExchangeCache({}),
      singleFlight: new SingleFlightExchange(),
    };
  }
  const accounts = createAccountBinding(process.env);
  const app = createImmoHttpApp(config, { data, raw, exchange, ...(accounts ? { authorize: accounts.authorize } : {}) });
  const { serve } = await import("@hono/node-server");
  serve({ fetch: app.fetch, port: config.port });
  process.stderr.write(
    `[immo-mcp-http] listening port=${config.port} resource=${config.resource} ` +
      `issuer=${config.issuer} dataMode=${config.dataMode} domainMode=${data.mode} ` +
      `rawMode=${raw.mode} requiredScopes=${config.requiredScopes.join(",")}\n`,
  );
}

// Run only when executed directly as the bin (not when imported by tests).
const selfPath = fileURLToPath(import.meta.url);
const entryPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryPath && (selfPath === entryPath || selfPath === `${entryPath}.js`)) {
  main().catch((err) => {
    process.stderr.write(`[immo-mcp-http] fatal: ${String(err)}\n`);
    process.exit(1);
  });
}
