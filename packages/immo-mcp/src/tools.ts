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
 * Hard char bound on GeoJSON tool answers (~1 MB serialized, compact JSON).
 * `limit`/`bbox` are the primary bounds; this is the last-resort guard so a
 * pathological page (huge multipolygons) can never flood the MCP client.
 */
const MAX_GEOJSON_RESPONSE_CHARS = 1_000_000;

/** GeoJSON results are serialized COMPACT (no indent): size matters here. */
function geojsonResult(payload: RawFeatureCollectionResult): TextResult {
  const text = JSON.stringify(payload);
  if (text.length > MAX_GEOJSON_RESPONSE_CHARS) {
    throw new Error(
      `response_too_large: ${text.length} caractères (max ${MAX_GEOJSON_RESPONSE_CHARS}). ` +
        "Réduisez limit ou resserrez bbox.",
    );
  }
  return { content: [{ type: "text", text }] };
}

/**
 * Shared bound checks for the two GeoJSON tools: valid bbox when present,
 * and bbox REQUIRED past the default page size (anti "give me the whole
 * city" — 15 000+ lots would flood the context).
 */
function checkGeoBounds(args: { bbox?: Bbox | undefined; limit: number }): void {
  if (args.bbox) assertValidBbox(args.bbox);
  if (args.limit > RAW_GEOJSON_DEFAULT_LIMIT && !args.bbox) {
    throw new Error(
      `bbox_required: limit > ${RAW_GEOJSON_DEFAULT_LIMIT} exige un bbox ` +
        "[minLon, minLat, maxLon, maxLat] pour borner la réponse.",
    );
  }
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

/**
 * Registers every read-only tool on the server: the 6 v0 domain tools
 * (backed by `ctx.data`) + the 4 raw-data tools (backed by `ctx.raw` —
 * zones/lots GeoJSON, grille & PV PDFs). Shared by BOTH transports
 * (server.ts stdio and server-http.ts Streamable HTTP).
 */
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

  server.registerTool(
    "get_zones_geojson",
    {
      title: "Get zones GeoJSON",
      description:
        "FeatureCollection GeoJSON des zones de zonage d'une ville (code de zone, kind, " +
        "grille PDF et propriétés sources). Réponse BORNÉE : limit défaut 500 (max 2000), " +
        "bbox [minLon,minLat,maxLon,maxLat] OBLIGATOIRE pour limit > 500. " +
        "numberMatched/numberReturned/truncated indiquent ce qui reste : si truncated, " +
        "resserrez le bbox. Read-only.",
      inputSchema: {
        city: z.string().min(1).describe("Ville (slug, ex: longueuil, valleyfield, delson)"),
        bbox: bboxSchema,
        limit: limitSchema,
      },
    },
    guarded(ctx, "get_zones_geojson", IMMO_SCOPES.read, async (args) => {
      checkGeoBounds(args);
      return geojsonResult(await ctx.raw.getZonesGeojson(args));
    }),
  );

  server.registerTool(
    "get_lots_geojson",
    {
      title: "Get lots GeoJSON",
      description:
        "FeatureCollection GeoJSON des lots cadastraux d'une ville, enrichis server-side : " +
        "zone jointe (zone.code/kind/densiteLogHa/usages/grillePdfUrl), zoneCode, " +
        "multifamilial4plus (+ multifamilial4plusSource: grille|heuristique), superficieM2, " +
        "tod/priorite quand la source les porte. Réponse BORNÉE : limit défaut 500 (max 2000), " +
        "bbox OBLIGATOIRE pour limit > 500 ; une ville peut dépasser 15 000 lots — paginez " +
        "par bbox. Filtres optionnels only4Plus/superficieMinM2 appliqués sur la page " +
        "récupérée. truncated=true → resserrez le bbox. Read-only.",
      inputSchema: {
        city: z.string().min(1).describe("Ville (slug, ex: longueuil, valleyfield, delson)"),
        bbox: bboxSchema,
        limit: limitSchema,
        only4Plus: z
          .boolean()
          .optional()
          .describe("Ne garder que les lots dont multifamilial4plus === true"),
        superficieMinM2: z
          .number()
          .positive()
          .optional()
          .describe("Superficie minimale en m² (champ superficieM2)"),
      },
    },
    guarded(ctx, "get_lots_geojson", IMMO_SCOPES.read, async (args) => {
      checkGeoBounds(args);
      return geojsonResult(await ctx.raw.getLotsGeojson(args));
    }),
  );

  server.registerTool(
    "get_grille_pdf",
    {
      title: "Get grille de zonage PDF",
      description:
        "URL de la grille de zonage PDF (grillePdfUrl) d'une zone d'une ville, quand la " +
        "source municipale la porte. L'URL retournée est publique : elle peut être lue " +
        "directement. Retourne found=false si la zone est inconnue, grillePdfUrl=null si la " +
        "zone existe sans grille. Read-only.",
      inputSchema: {
        city: z.string().min(1).describe("Ville (slug, ex: longueuil)"),
        zone: z.string().min(1).describe("Code de zonage (ex: H-203)"),
      },
    },
    guarded(ctx, "get_grille_pdf", IMMO_SCOPES.documentsRead, async (args) =>
      jsonResult(await ctx.raw.getGrillePdf(args)),
    ),
  );

  server.registerTool(
    "get_pv_pdf",
    {
      title: "Get PV source PDF",
      description:
        "URL servie du procès-verbal source (PDF archivé) d'un signal, à partir de sa " +
        "référence brute rawRef (ex: raw/proces-verbaux-<ville>/cas/<sha>.pdf, telle que " +
        "portée par les signaux/documents) + métadonnées (ville, content-type). " +
        "Le PDF lui-même n'est jamais inliné dans la réponse. Read-only.",
      inputSchema: {
        rawRef: z
          .string()
          .min(1)
          .describe(
            "Référence brute du document (rawRef S3, ex: raw/proces-verbaux-longueuil/cas/<sha>.pdf ; " +
              "en mode mock: l'id de document, ex: doc-longueuil-pv-2026-04-14)",
          ),
      },
    },
    guarded(ctx, "get_pv_pdf", IMMO_SCOPES.documentsRead, async (args) =>
      jsonResult(await ctx.raw.getPvPdf(args)),
    ),
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
  "get_zones_geojson",
  "get_lots_geojson",
  "get_grille_pdf",
  "get_pv_pdf",
] as const;

/** Every tool registered by `registerTools` (used by tests + docs). */
export const ALL_TOOL_NAMES = [...V0_TOOL_NAMES, ...RAW_TOOL_NAMES] as const;
