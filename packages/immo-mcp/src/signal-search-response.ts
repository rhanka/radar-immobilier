import { z } from "zod";
import type { MockSignal } from "./mocks.js";
import { RadarSignalReadError } from "./signal-read-error.js";

export const SIGNAL_SEARCH_PATH = "/api/v1/mcp/facets/signals/search";
const city = z.string().regex(/^[a-z0-9]+(?:-+[a-z0-9]+)*$/).max(128);
const workspace = z.string().uuid().refine((value) => value === value.toLowerCase());
const signal = z.object({
  id: z.string().min(1), city, type: z.string(), etape: z.string(),
  regulatoryStatus: z.enum(["firm", "anticipation"]), etape_date: z.string(),
  reglement_number: z.string(), zone_ref: z.string(), no_lot: z.string().nullable(),
  summary: z.string(), source_document_id: z.string(),
}).strict();
const envelope = z.object({
  ok: z.literal(true), workspaceId: workspace, citySlug: city, signals: z.array(signal),
}).strict();

/** API owns normalization and filtering; the MCP validates without reclassification. */
export function parseSignalSearchResponse(body: unknown, expected: {
  city: string; limit: number; workspaceId?: string | undefined;
}): MockSignal[] {
  const parsed = envelope.safeParse(body);
  if (!parsed.success || parsed.data.citySlug !== expected.city ||
    parsed.data.signals.length > expected.limit ||
    parsed.data.signals.some((item) => item.city !== expected.city) ||
    (expected.workspaceId !== undefined && parsed.data.workspaceId !== expected.workspaceId.toLowerCase())) {
    throw new RadarSignalReadError("radar_api_bad_payload", 200);
  }
  return parsed.data.signals;
}
