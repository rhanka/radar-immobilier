import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  assertScope,
  auditToolCall,
  hashInput,
  type ImmoMcpAuthContext,
} from "./auth-context.js";
import type { ImmoDataSource } from "./data-source.js";
import type { RawDataSource } from "./raw-data.js";
import {
  captureInvocationContext,
  getInvocationContext,
  type InvocationContext,
} from "./invocation-context.js";
import { ALL_TOOL_DEFINITIONS, IMMO_READ_ANNOTATIONS } from "./tool-definitions.js";
import { RadarSignalReadError } from "./signal-read-error.js";
import { TOOL_HANDLERS, type ToolTextResult } from "./tool-handlers.js";
import { installNormalizedListHandler } from "./zod4-list-handler.js";

export interface ToolContext {
  auth: ImmoMcpAuthContext;
  data: ImmoDataSource;
  /** Raw-data seam (zones/lots GeoJSON, grille & PV PDFs) — see raw-data.ts. */
  raw: RawDataSource;
}

/**
 * SDK contract harness for baseline and handler-binding tests. Production HTTP
 * and fixture stdio install the cluster-mesh bridge instead. Both paths call
 * the same native handler function below with an immutable invocation snapshot.
 */
export function registerTools(server: McpServer, ctx: ToolContext): void {
  const registrations = [];
  for (const def of ALL_TOOL_DEFINITIONS) {
    const handler = TOOL_HANDLERS[def.name];
    if (!handler) throw new Error(`missing_handler:${def.name}`);
    const registered = server.registerTool(
      def.name,
      { title: def.title, description: def.description, inputSchema: def.inputSchema,
        annotations: IMMO_READ_ANNOTATIONS },
      async (args): Promise<ToolTextResult> => {
        const snapshot =
          getInvocationContext() ??
          captureInvocationContext({ auth: ctx.auth, data: ctx.data, raw: ctx.raw });
        return invokeTool(def.name, args as Record<string, unknown>, snapshot);
      },
    );
    registrations.push({ definition: def, registered });
  }
  installNormalizedListHandler(server, registrations);
}

/** Native wire result shared by composition and the contract-test registrar. */
export async function invokeTool(name: string, args: Record<string, unknown>, snapshot: InvocationContext): Promise<ToolTextResult> {
        const def = ALL_TOOL_DEFINITIONS.find((entry) => entry.name === name);
        const handler = TOOL_HANDLERS[name];
        if (!def || !handler) throw new Error(`missing_handler:${name}`);
        const correlationId = randomUUID();
        try {
          assertScope(snapshot.auth, def.scope);
          auditToolCall(snapshot.auth, def.name, hashInput(args), correlationId);
          return await handler(args as Record<string, unknown>, snapshot);
        } catch (err) {
          if (err instanceof RadarSignalReadError) {
            const payload = err.toPublicPayload(def.name, correlationId);
            process.stderr.write(`${JSON.stringify({ kind: "immo-mcp.error", ...payload })}\n`);
            return { isError: true, content: [{ type: "text", text: JSON.stringify(payload) }] };
          }
          const message = err instanceof Error ? err.message : String(err);
          // stderr only — never leak to the protocol stdout channel.
          process.stderr.write(
            `${JSON.stringify({
              at: new Date().toISOString(),
              kind: "immo-mcp.error",
              tool: def.name,
              correlationId,
              message,
            })}\n`,
          );
          const result: ToolTextResult = {
            content: [{ type: "text", text: JSON.stringify({ error: message, tool: def.name, correlationId }, null, 2) }],
          };
          result.isError = true;
          return result;
        }
}

/** Names of the tools registered in v0 (used by tests + docs). */
export const V0_TOOL_NAMES = [
  "search_lots",
  "get_lot_card",
  "search_signals",
  "get_opportunity_dossier",
  "list_documents",
  "read_document_excerpt",
] as const;

/** Names of the raw-data tools (zones/lots GeoJSON, grille & PV PDFs). */
export const RAW_TOOL_NAMES = [
  "get_reglement_provenance",
  "query_zoning_events",
  "get_zones_geojson",
  "get_lots_geojson",
  "get_grille_pdf",
  "get_pv_pdf",
] as const;

/** Every tool registered by `registerTools` (used by tests + docs). */
export const ALL_TOOL_NAMES = [...V0_TOOL_NAMES, ...RAW_TOOL_NAMES] as const;
