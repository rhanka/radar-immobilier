import { randomUUID } from "node:crypto";
import { captureInvocationContext, getInvocationContext } from "./invocation-context.js";
import { ALL_TOOL_DEFINITIONS } from "./tool-definitions.js";
import { TOOL_HANDLERS, type ToolTextResult } from "./tool-handlers.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  assertScope,
  auditToolCall,
  hashInput,
  IMMO_SCOPES,
  redact,
  type ImmoMcpAuthContext,
} from "./auth-context.js";
import type { ImmoDataSource } from "./data-source.js";
import {
  assertValidBbox,
  RAW_GEOJSON_DEFAULT_LIMIT,
  RAW_GEOJSON_MAX_LIMIT,
  type Bbox,
  type RawDataSource,
  type RawFeatureCollectionResult,
} from "./raw-data.js";

export interface ToolContext {
  auth: ImmoMcpAuthContext;
  data: ImmoDataSource;
  /** Raw-data seam (zones/lots GeoJSON, grille & PV PDFs) — see raw-data.ts. */
  raw: RawDataSource;
}

/**
 * Registers every read-only tool on the server: the 6 v0 domain tools
 * (backed by `ctx.data`) + the 4 raw-data tools (backed by `ctx.raw` —
 * zones/lots GeoJSON, grille & PV PDFs). Shared by BOTH transports
 * (server.ts stdio and server-http.ts Streamable HTTP).
 */
export function registerTools(server: McpServer, ctx: ToolContext): void {
  for (const def of ALL_TOOL_DEFINITIONS) {
    const handler = TOOL_HANDLERS[def.name];
    if (!handler) throw new Error(`missing_handler:${def.name}`);
    server.registerTool(
      def.name,
      { title: def.title, description: def.description, inputSchema: def.inputSchema },
      async (args): Promise<ToolTextResult> => {
        const snapshot =
          getInvocationContext() ??
          captureInvocationContext({ auth: ctx.auth, data: ctx.data, raw: ctx.raw });
        const correlationId = randomUUID();
        try {
          assertScope(snapshot.auth, def.scope);
          auditToolCall(snapshot.auth, def.name, hashInput(args), correlationId);
          return await handler(args as Record<string, unknown>, snapshot);
        } catch (err) {
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
      },
    );
  }

  // ── Raw-data tools (ad hoc representations côté client MCP) ───────────────
  // Shared zod pieces. The DESCRIPTIONS are part of the contract: they are what
  // guides claude.ai to stay within the size bounds (limit/bbox/truncated).
  const bboxSchema = z
    .tuple([z.number(), z.number(), z.number(), z.number()])
    .optional()
    .describe(
      "Emprise [minLon, minLat, maxLon, maxLat] en WGS84 (ex: [-73.53, 45.52, -73.5, 45.55]). " +
        "Obligatoire quand limit > 500.",
    );
  const limitSchema = z
    .number()
    .int()
    .min(1)
    .max(RAW_GEOJSON_MAX_LIMIT)
    .default(RAW_GEOJSON_DEFAULT_LIMIT)
    .describe(
      `Nombre max de features retournées (défaut ${RAW_GEOJSON_DEFAULT_LIMIT}, ` +
        `max ${RAW_GEOJSON_MAX_LIMIT} — bbox obligatoire au-delà de ${RAW_GEOJSON_DEFAULT_LIMIT}).`,
    );
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
