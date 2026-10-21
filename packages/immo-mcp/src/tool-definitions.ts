import { z } from "zod";
import { IMMO_SCOPES } from "./auth-context.js";
import {
  RAW_GEOJSON_DEFAULT_LIMIT,
  RAW_GEOJSON_MAX_LIMIT,
} from "./raw-data.js";

/**
 * Single source of the twelve tool contracts consumed by the SDK registrar
 * and, later, the cluster-mesh bridge. Schemas, titles, descriptions, bounds
 * and defaults are byte-identical to the pre-extraction registrar: any drift
 * breaks the deployed-baseline fixture comparison.
 */
export interface ToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Record<string, z.ZodTypeAny>;
  readonly scope: string;
}

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

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: "search_lots",
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
    scope: IMMO_SCOPES.search,
  },
  {
    name: "get_lot_card",
    title: "Get lot card",
    description: "Fiche détaillée d'un lot (zonage, superficie, signaux liés). Read-only.",
    inputSchema: {
      city: z.string().min(1),
      no_lot: z.string().min(1).describe("Numéro de lot cadastral exact"),
    },
    scope: IMMO_SCOPES.read,
  },
  {
    name: "search_signals",
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
      showDiscarded: z
        .boolean()
        .optional()
        .describe("Reveal archived signals hidden by default (default false). Read-only."),
      limit: z.number().int().min(1).max(100).default(20),
    },
    scope: IMMO_SCOPES.search,
  },
];

/** Raw-data tool contracts (zones/lots GeoJSON, grille & PV PDFs, provenance). */
export const RAW_TOOL_DEFINITIONS: readonly ToolDefinition[] = [];

/** Every tool contract in registration order (domain first, raw-data second). */
export const ALL_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  ...TOOL_DEFINITIONS,
  ...RAW_TOOL_DEFINITIONS,
];

/** Scope required per tool name (mirrors the registrar enforcement). */
export const TOOL_SCOPE_BY_NAME: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(ALL_TOOL_DEFINITIONS.map((def) => [def.name, def.scope])),
);
