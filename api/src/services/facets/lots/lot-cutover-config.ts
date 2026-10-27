/** Server-only 6K maintenance configuration, read at route construction. */
import { z } from "zod";
import { ScopeError } from "../scope.js";

const text = z.string().min(1).max(256);
const configSchema = z.object({
  workspaceId: z.string().guid(),
  mapping: z.object({ mappingVersion: text, importerVersion: text,
    destinationsQualified: z.literal(true) }).strict(),
  maintenance: z.object({
    maintenanceAttemptId: z.string().guid(), releaseId: text,
    instanceIds: z.array(text).min(1), evidence: z.unknown().optional(),
    options: z.object({
      qualifiedEmptyManifest: z.boolean().optional(),
      emptyReadbackScope: z.object({ citySlugs: z.array(text).min(1),
        modes: z.array(z.enum(["real", "simulation"])).min(1) }).strict().optional(),
    }).strict().optional(),
  }).strict(),
}).strict();

export function readLotCutoverServerConfig(raw = process.env["BASE_API_LOT_CUTOVER_CONFIG"]) {
  if (raw === undefined || raw === "") return undefined;
  try { return configSchema.parse(JSON.parse(raw)); }
  catch { throw new ScopeError(503, "lot_cutover_configuration_invalid"); }
}
