import { randomUUID } from "node:crypto";
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

export interface ToolContext {
  auth: ImmoMcpAuthContext;
  data: ImmoDataSource;
}

type TextResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function jsonResult(payload: unknown, isError = false): TextResult {
  const result: TextResult = {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
  if (isError) result.isError = true;
  return result;
}

/**
 * Wraps a tool handler with the cross-cutting concerns every immo tool needs:
 * scope check (from the auth CONTEXT, never from args), audit logging with an
 * input hash + correlationId, and uniform error shaping. The LLM-supplied
 * `args` are treated purely as query parameters.
 */
function guarded<A>(
  ctx: ToolContext,
  toolName: string,
  scope: string,
  handler: (args: A) => Promise<TextResult>,
): (args: A) => Promise<TextResult> {
  return async (args: A) => {
    const correlationId = randomUUID();
    try {
      assertScope(ctx.auth, scope);
      auditToolCall(ctx.auth, toolName, hashInput(args), correlationId);
      return await handler(args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // stderr only — never leak to the protocol stdout channel.
      process.stderr.write(
        `${JSON.stringify({
          at: new Date().toISOString(),
          kind: "immo-mcp.error",
          tool: toolName,
          correlationId,
          message,
        })}\n`,
      );
      return jsonResult({ error: message, tool: toolName, correlationId }, true);
    }
  };
}

/** Registers the 6 read-only v0 tools on the server. */
export function registerTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "search_lots",
    {
      title: "Search lots",
      description:
        "Recherche de lots par ville et critères (zone, no_lot, superficie min). Read-only.",
      inputSchema: {
        city: z.string().min(1).describe("Ville (ex: longueuil, valleyfield)"),
        zone: z.string().optional().describe("Code de zonage (ex: H-203)"),
        no_lot: z.string().optional().describe("Numéro de lot cadastral exact"),
        minArea: z.number().positive().optional().describe("Superficie minimale en m²"),
        limit: z.number().int().min(1).max(100).default(20),
      },
    },
    guarded(ctx, "search_lots", IMMO_SCOPES.search, async (args) => {
      const lots = await ctx.data.searchLots(args);
      return jsonResult({ city: args.city, count: lots.length, lots });
    }),
  );

  server.registerTool(
    "get_lot_card",
    {
      title: "Get lot card",
      description: "Fiche détaillée d'un lot (zonage, superficie, signaux liés). Read-only.",
      inputSchema: {
        city: z.string().min(1),
        no_lot: z.string().min(1).describe("Numéro de lot cadastral exact"),
      },
    },
    guarded(ctx, "get_lot_card", IMMO_SCOPES.read, async (args) => {
      const card = await ctx.data.getLotCard(args);
      if (!card) return jsonResult({ found: false, city: args.city, no_lot: args.no_lot });
      return jsonResult({ found: true, lot: card });
    }),
  );

  server.registerTool(
    "search_signals",
    {
      title: "Search signals",
      description:
        "Recherche de signaux réglementaires par ville (étape, mot-clé). Read-only.",
      inputSchema: {
        city: z.string().min(1),
        etape: z
          .string()
          .optional()
          .describe("Étape du processus (ex: avis_motion, adoption, consultation)"),
        query: z.string().optional().describe("Mot-clé libre"),
        limit: z.number().int().min(1).max(100).default(20),
      },
    },
    guarded(ctx, "search_signals", IMMO_SCOPES.search, async (args) => {
      const signals = await ctx.data.searchSignals(args);
      return jsonResult({ city: args.city, count: signals.length, signals });
    }),
  );

  server.registerTool(
    "get_opportunity_dossier",
    {
      title: "Get opportunity dossier",
      description:
        "Dossier d'opportunité consolidé (score, lots et signaux liés, rationale). Read-only.",
      inputSchema: {
        city: z.string().min(1),
        opportunityId: z.string().min(1),
      },
    },
    guarded(ctx, "get_opportunity_dossier", IMMO_SCOPES.read, async (args) => {
      const dossier = await ctx.data.getOpportunityDossier(args);
      if (!dossier) {
        return jsonResult({ found: false, city: args.city, opportunityId: args.opportunityId });
      }
      return jsonResult({ found: true, dossier });
    }),
  );

  server.registerTool(
    "list_documents",
    {
      title: "List documents",
      description:
        "Liste les documents sources archivés (procès-verbaux, etc.) par ville. Read-only.",
      inputSchema: {
        city: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(20),
      },
    },
    guarded(ctx, "list_documents", IMMO_SCOPES.documentsRead, async (args) => {
      const documents = await ctx.data.listDocuments(args);
      return jsonResult({ count: documents.length, documents });
    }),
  );

  server.registerTool(
    "read_document_excerpt",
    {
      title: "Read document excerpt",
      description:
        "Lit un extrait borné d'un document source. La sortie est passée par la redaction anti-PII. Read-only.",
      inputSchema: {
        documentId: z.string().min(1),
        offset: z.number().int().min(0).default(0),
        maxChars: z.number().int().min(1).max(4000).default(1200),
      },
    },
    guarded(ctx, "read_document_excerpt", IMMO_SCOPES.documentsRead, async (args) => {
      const body = await ctx.data.readDocumentBody(args.documentId);
      if (!body) return jsonResult({ found: false, documentId: args.documentId });
      const total = body.text.length;
      const slice = body.text.slice(args.offset, args.offset + args.maxChars);
      const excerpt = redact(slice); // anti-PII defence-in-depth
      return jsonResult({
        found: true,
        documentId: args.documentId,
        title: body.title,
        offset: args.offset,
        length: slice.length,
        total_length: total,
        truncated: args.offset + slice.length < total,
        excerpt,
      });
    }),
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
