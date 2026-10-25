#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { resolveAuthContext } from "./auth-context.js";
import { createDataSource } from "./data-source.js";
import { createRawDataSource } from "./raw-data.js";
import { IMMO_MCP_NAME, IMMO_MCP_VERSION } from "./meta.js";
import { ImmoStatefulHost } from "./stateful-host.js";
import { composeStatefulImmo } from "./registry/stateful-composition.js";
import { captureInvocationContext, runWithInvocationContext } from "./invocation-context.js";

export { IMMO_MCP_NAME, IMMO_MCP_VERSION };

/**
 * Builds a fixture-only MCP server with synthetic claims from env.
 * Real API and storage settings are ignored at this boundary.
 * Exported so tests can drive it over an in-memory transport without stdio.
 */
export async function buildImmoServer(env: NodeJS.ProcessEnv = process.env): Promise<McpServer> {
  const auth = resolveAuthContext(env); // stub now, OAuth-ready
  // Synthetic claims are confined to fixture data even if real URLs are inherited.
  const data = createDataSource({});
  const raw = createRawDataSource({});
  const server = new McpServer({ name: IMMO_MCP_NAME, version: IMMO_MCP_VERSION });
  const host = new ImmoStatefulHost(new Hono());
  host.retain(server.server);
  await composeStatefulImmo(host, async () => true);
  const snapshot = captureInvocationContext({ auth, data, raw });
  const connect = server.connect.bind(server);
  server.connect = async (transport) => {
    await connect(transport);
    const onmessage = transport.onmessage;
    transport.onmessage = (message, extra) => {
      void runWithInvocationContext(snapshot, () => host.run({
        principal: { issuer: "synthetic:stdio", sub: snapshot.auth.sub,
          scopes: snapshot.auth.scopes, claims: [], attributes: {} },
        resource: "synthetic:immo", correlationId: randomUUID(), signal: new AbortController().signal,
      }, async () => { onmessage?.(message, extra); })).catch(() => transport.onerror?.(new Error("composition_unavailable")));
    };
  };
  return server;
}

async function main(): Promise<void> {
  const server = await buildImmoServer(process.env);
  const transport = new StdioServerTransport();
  await server.connect(transport); // stdio: NEVER write to stdout outside the protocol
  process.stderr.write(
    `[immo-mcp] ready name=${IMMO_MCP_NAME} version=${IMMO_MCP_VERSION} ` +
      `mode=synthetic\n`,
  );
}

// Run only when executed directly as the bin (not when imported by tests).
const selfPath = fileURLToPath(import.meta.url);
const entryPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryPath && (selfPath === entryPath || selfPath === `${entryPath}.js`)) {
  main().catch((err) => {
    process.stderr.write(`[immo-mcp] fatal: ${String(err)}\n`);
    process.exit(1);
  });
}
