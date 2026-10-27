/**
 * Immo provider definition for P3 embedded configuration.
 *
 * Owns the exact public names of the twelve Immo tools and their bindings to
 * the existing handlers in `tools.ts` (`registerTools` over the `data` and
 * `raw` context seams). No network access, no secrets, no central registry.
 */

export const IMMO_PROVIDER_ID = "immo" as const;
export const IMMO_PROVIDER_VERSION = "0.0.1" as const;
export const IMMO_ENTRY_SCOPE = "immo:read" as const;

export const IMMO_TOOL_NAMES = [
  "search_lots",
  "get_lot_card",
  "search_signals",
  "get_opportunity_dossier",
  "list_documents",
  "read_document_excerpt",
  "get_reglement_provenance",
  "query_zoning_events",
  "get_zones_geojson",
  "get_lots_geojson",
  "get_grille_pdf",
  "get_pv_pdf",
] as const;

export type ImmoToolName = (typeof IMMO_TOOL_NAMES)[number];

export const IMMO_TOOL_SCOPES: Record<ImmoToolName, string> = {
  search_lots: "immo:search",
  get_lot_card: "immo:read",
  search_signals: "immo:search",
  get_opportunity_dossier: "immo:read",
  list_documents: "immo:documents:read",
  read_document_excerpt: "immo:documents:read",
  get_reglement_provenance: "immo:read",
  query_zoning_events: "immo:read",
  get_zones_geojson: "immo:read",
  get_lots_geojson: "immo:read",
  get_grille_pdf: "immo:documents:read",
  get_pv_pdf: "immo:documents:read",
};

export type ImmoHandlerContext = "data" | "raw";

export interface ImmoToolBinding {
  readonly context: ImmoHandlerContext;
  readonly registeredBy: "registerTools";
}

export const IMMO_TOOL_BINDINGS: Record<ImmoToolName, ImmoToolBinding> = {
  search_lots: { context: "data", registeredBy: "registerTools" },
  get_lot_card: { context: "data", registeredBy: "registerTools" },
  search_signals: { context: "data", registeredBy: "registerTools" },
  get_opportunity_dossier: { context: "data", registeredBy: "registerTools" },
  list_documents: { context: "data", registeredBy: "registerTools" },
  read_document_excerpt: { context: "data", registeredBy: "registerTools" },
  get_reglement_provenance: { context: "raw", registeredBy: "registerTools" },
  query_zoning_events: { context: "raw", registeredBy: "registerTools" },
  get_zones_geojson: { context: "raw", registeredBy: "registerTools" },
  get_lots_geojson: { context: "raw", registeredBy: "registerTools" },
  get_grille_pdf: { context: "raw", registeredBy: "registerTools" },
  get_pv_pdf: { context: "raw", registeredBy: "registerTools" },
};

export function isImmoToolName(name: string): name is ImmoToolName {
  return (IMMO_TOOL_NAMES as readonly string[]).includes(name);
}
