import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { convertInputShape, normalizeToolJsonSchema } from "./zod4-jsonschema.js";
import type { ToolDefinition } from "./tool-definitions.js";

/** Capture the public registrations, including enabled state and metadata. */
export function installNormalizedListHandler(server: McpServer, registrations: {
  definition: ToolDefinition;
  registered: ReturnType<McpServer["registerTool"]>;
}[]): void {
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: registrations.filter(({ registered }) => registered.enabled).map(({ definition: def, registered }) => ({
      name: def.name,
      title: registered.title,
      description: registered.description,
      inputSchema: normalizeToolJsonSchema(def.name, convertInputShape(def.inputSchema)),
      annotations: registered.annotations,
      execution: registered.execution,
      _meta: registered._meta,
    })),
  }));
}
