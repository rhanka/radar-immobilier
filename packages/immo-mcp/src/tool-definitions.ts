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

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [];

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
