#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveAuthContext } from "./auth-context.js";
import { createDataSource } from "./data-source.js";
import { registerTools } from "./tools.js";

export const IMMO_MCP_NAME = "immo";
export const IMMO_MCP_VERSION = "0.0.1";

/**
 * Builds a fully wired immo MCP server from env (auth stub + data source seam).
 * Exported so tests can drive it over an in-memory transport without stdio.
 */
export function buildImmoServer(env: NodeJS.ProcessEnv = process.env): McpServer {
  const auth = resolveAuthContext(env); // stub now, OAuth-ready
  const data = createDataSource(env); // mock (default) | http seam
  const server = new McpServer({ name: IMMO_MCP_NAME, version: IMMO_MCP_VERSION });
  registerTools(server, { auth, data });
  return server;
}

async function main(): Promise<void> {
  const server = buildImmoServer(process.env);
  const transport = new StdioServerTransport();
  await server.connect(transport); // stdio: NEVER write to stdout outside the protocol
  process.stderr.write(
    `[immo-mcp] ready name=${IMMO_MCP_NAME} version=${IMMO_MCP_VERSION} ` +
      `mode=${process.env.IMMO_MCP_DATA_MODE === "http" ? "http" : "mock"}\n`,
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
