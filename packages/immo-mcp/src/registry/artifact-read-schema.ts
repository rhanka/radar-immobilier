import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const ARTIFACT_LIST_ORDER = "updatedAt descending, nulls last, then createdAt descending; artifactId ascending breaks ties";

const summary = {
  type: "object" as const,
  properties: {
    artifactId: { type: "string", format: "uuid" },
    bindingName: { type: "string", description: "Display label until part1 title/description metadata is available." },
    stableUrl: { type: "string", format: "uri" },
    pinnedUrl: { type: ["string", "null"], format: "uri", description: "Current release URL, or null if unpublished." },
    currentReleaseId: { type: ["string", "null"], format: "uuid" },
    createdAt: { type: "string", format: "date-time", description: "Artifact creation time." },
    updatedAt: { type: ["string", "null"], format: "date-time", description: "Current release publication time, or null if never published." },
    state: { type: "string", enum: ["active", "withdrawn", "deleted", "purged"], description: "Artifact lifecycle state." },
    published: { type: "boolean", description: "Whether a current release exists; consult state for lifecycle availability." },
  },
  required: ["artifactId", "bindingName", "stableUrl", "pinnedUrl", "currentReleaseId", "createdAt", "updatedAt", "state", "published"],
  additionalProperties: true,
};

/** IMMO-only additive response contract, independent of the installed provider version. */
export function artifactReadOutputSchema(name: string): Tool["outputSchema"] {
  if (name === "artifacts_get") return summary;
  if (name !== "artifacts_list") return undefined;
  return { type: "object", description: `Visible artifacts ordered by ${ARTIFACT_LIST_ORDER}, before offset/limit pagination.`,
    properties: {
      total: { type: "integer", minimum: 0 },
      artifacts: { type: "array", description: `Ordered by ${ARTIFACT_LIST_ORDER}.`, items: summary },
    }, required: ["total", "artifacts"], additionalProperties: true };
}
