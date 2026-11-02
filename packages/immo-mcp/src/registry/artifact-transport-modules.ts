import type { createClusterMeshModules } from "@sentropic/cluster-mesh";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
type ClusterMeshModules = ReturnType<typeof createClusterMeshModules>;

/** Keep discovery schemas intact; defer only CAS presence to authorized receipt lookup.
 * Native budgets, closed-input validation, scopes and dispatch remain in mcp-platform.
 * Explicit null or release IDs always use the original validator. No input value is filled.
 */
export function deferArtifactPrecondition(modules: ClusterMeshModules, selected: readonly Tool[]): ClusterMeshModules {
  const writes = new Set(selected.map((tool) => tool.name).filter((name) =>
    ["artifacts_publish", "artifacts_revert", "artifacts_delete"].includes(name)));
  return { ...modules, async load(id) {
    const loaded = await modules.load(id);
    if (id !== "mcp-platform/tool-schemas") return loaded;
    const leaf = loaded as typeof import("@sentropic/mcp-platform/transport/tool-schemas");
    return { ...leaf, compileMcpToolSchemas: ((tools, limits) => {
      const original = leaf.compileMcpToolSchemas(tools, limits);
      const historic = leaf.compileMcpToolSchemas(tools.map((tool) => writes.has(tool.name) ? { ...tool,
        inputSchema: { ...tool.inputSchema,
          required: (tool.inputSchema.required ?? []).filter((key) => key !== "expectedCurrentReleaseId") },
      } : tool), limits);
      return { validate(name, args) {
        return writes.has(name) && args !== null && typeof args === "object" && !Array.isArray(args) &&
          !Object.hasOwn(args, "expectedCurrentReleaseId") ? historic.validate(name, args) : original.validate(name, args);
      } };
    }) satisfies typeof leaf.compileMcpToolSchemas };
  } };
}
