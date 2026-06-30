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
import { createDataSource, type ImmoDataSource } from "./data-source.js";
import { IMMO_MCP_NAME, IMMO_MCP_VERSION } from "./server.js";
import { registerTools } from "./tools.js";

/**
 * REMOTE transport for the immo MCP provider: Streamable HTTP (MCP SDK) behind an
 * OAuth 2.1 Resource Server (RFC 9728 PRM + RFC 6750 challenges) implemented by the
 * PUBLISHED packages @sentropic/mcp-auth (+ @sentropic/oauth-verify).
 *
 * This file is ADDITIVE: the stdio entrypoint (`server.ts`) is untouched. Both share
 * `registerTools` + the `ImmoMcpAuthContext` seam — only the AUTH SOURCE differs:
 *   - stdio  → `resolveAuthContext(env)` (claims stubbed from env)
 *   - http   → claims of a validated bearer token (this file's `authContextFromMcp`).
 *
 * Data stays MOCK here (cadrage v0): the real radar API is NOT wired in the remote POC.
 */

const DEFAULT_SUPPORTED_SCOPES = `${IMMO_SCOPES.read} ${IMMO_SCOPES.search} ${IMMO_SCOPES.documentsRead}`;
const DEFAULT_HTTP_PORT = 8848;

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
  return ctx;
}

function buildHttpScopedServer(auth: ImmoMcpAuthContext, data: ImmoDataSource): McpServer {
  const server = new McpServer({ name: IMMO_MCP_NAME, version: IMMO_MCP_VERSION });
  registerTools(server, { auth, data });
  return server;
}

/** Test/wiring overrides — keeps the prod path env-only while letting tests inject a key source. */
export interface ImmoHttpDeps {
  /** Override the data source (default = `createDataSource({})` → MockDataSource). */
  data?: ImmoDataSource;
  /** Override the token key source (default = remote JWKS off the issuer/jwksUri). */
  keySource?: TokenKeySource;
}

interface SessionEntry {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
}

/**
 * Build the Hono app exposing:
 *   - GET  /.well-known/oauth-protected-resource  → RFC 9728 PRM (public)
 *   - *    /mcp                                    → OAuth RS guard (401/403 + WWW-Authenticate)
 *   - POST/GET/DELETE /mcp                         → MCP Streamable HTTP transport (stateful)
 */
export function createImmoHttpApp(config: ImmoHttpConfig, deps: ImmoHttpDeps = {}): Hono {
  const data = deps.data ?? createDataSource({});

  const mcpAuthConfig: McpAuthConfig = {
    resource: config.resource,
    authorizationServers: [config.issuer],
    scopesSupported: config.scopesSupported,
  };
  if (deps.keySource) mcpAuthConfig.keySource = deps.keySource;
  else if (config.jwksUri) mcpAuthConfig.keySource = fromRemoteJwks(config.jwksUri);
  const mcp = createMcpAuth(mcpAuthConfig);

  const app = new Hono();

  // RFC 9728 Protected Resource Metadata (default-off in raw mcp-auth → turned ON here).
  app.route("/", mcpAuthRoutes(mcp));

  // OAuth Resource Server guard: validates the bearer (issuer/audience/scope), or returns
  // 401/403 with the proper WWW-Authenticate (resource_metadata + scope) challenge.
  app.use("/mcp", requireMcpAuth(mcp, { requiredScopes: config.requiredScopes }));

  const sessions = new Map<string, SessionEntry>();

  const jsonRpcError = (c: Context, status: 400 | 404, message: string): Response =>
    c.json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }, status);

  const handleMcp = async (c: Context): Promise<Response> => {
    const sessionId = c.req.header("mcp-session-id");

    if (sessionId) {
      const entry = sessions.get(sessionId);
      if (!entry) return jsonRpcError(c, 404, "Unknown or expired MCP session");
      return entry.transport.handleRequest(c.req.raw);
    }

    // No session yet: only a POST (the `initialize` request) may open one.
    if (c.req.method !== "POST") return jsonRpcError(c, 400, "Missing mcp-session-id header");

    const auth = authContextFromMcp(getMcpAuthContext(c), {
      audience: config.resource,
      dataMode: data.mode === "http" ? "real" : "simulation",
    });
    const server = buildHttpScopedServer(auth, data);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
    });
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) sessions.delete(sid);
    };
    await server.connect(transport);
    const response = await transport.handleRequest(c.req.raw);
    if (transport.sessionId) sessions.set(transport.sessionId, { transport, server });
    return response;
  };

  app.on(["POST", "GET", "DELETE"], "/mcp", handleMcp);

  return app;
}

async function main(): Promise<void> {
  const config = loadHttpConfig(process.env);
  const app = createImmoHttpApp(config);
  const { serve } = await import("@hono/node-server");
  serve({ fetch: app.fetch, port: config.port });
  process.stderr.write(
    `[immo-mcp-http] listening port=${config.port} resource=${config.resource} ` +
      `issuer=${config.issuer} dataMode=${config.dataMode} ` +
      `requiredScopes=${config.requiredScopes.join(",")}\n`,
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
