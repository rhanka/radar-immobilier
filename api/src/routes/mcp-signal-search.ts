/** Reserved API contract only. Production mounting belongs to A3/T09. */
import { z } from "zod";
import { ScopeError } from "../services/facets/scope.js";

export const MCP_SIGNAL_SEARCH_PATH = "/api/v1/mcp/facets/signals/search";
export const McpWorkspaceId = z.string().uuid().transform((value) => value.toLowerCase());
const city = z.string().min(1).max(128).regex(/^[a-z0-9]+(?:-+[a-z0-9]+)*$/);
export const McpSignalSearchInput = z.object({
  city, etape: z.string().optional(), query: z.string().optional(),
  showDiscarded: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(20),
  workspaceId: McpWorkspaceId.optional(),
}).strict();
export type McpSignalSearchArgs = z.infer<typeof McpSignalSearchInput>;

export const McpSignalSearchResponse = z.object({
  ok: z.literal(true), workspaceId: McpWorkspaceId, citySlug: city,
  signals: z.array(z.object({
    id: z.string().min(1), city, type: z.string(), etape: z.string(),
    regulatoryStatus: z.enum(["firm", "anticipation"]), etape_date: z.string(),
    reglement_number: z.string(), zone_ref: z.string(), no_lot: z.string().nullable(),
    summary: z.string(), source_document_id: z.string(),
  }).strict()),
}).strict();

export function decodeMcpSignalSearch(params: URLSearchParams): McpSignalSearchArgs {
  const values: Record<string, unknown> = {};
  for (const [key, value] of params) {
    if (!Object.hasOwn(McpSignalSearchInput.shape, key) || Object.hasOwn(values, key)) {
      throw new ScopeError(400, "invalid_signal_search");
    }
    values[key] = value;
  }
  if (values.workspaceId !== undefined && !McpWorkspaceId.safeParse(values.workspaceId).success) {
    throw new ScopeError(400, "workspace_malformed");
  }
  if (values.limit !== undefined) {
    if (!/^[1-9][0-9]*$/.test(String(values.limit))) {
      throw new ScopeError(400, "invalid_signal_search");
    }
    values.limit = Number(values.limit);
  }
  if (values.showDiscarded !== undefined) {
    if (values.showDiscarded !== "1" && values.showDiscarded !== "0") {
      throw new ScopeError(400, "invalid_signal_search");
    }
    values.showDiscarded = values.showDiscarded === "1";
  }
  const parsed = McpSignalSearchInput.safeParse(values);
  if (!parsed.success) throw new ScopeError(400, "invalid_signal_search");
  return parsed.data;
}
