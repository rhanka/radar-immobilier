/**
 * Real STDIO proof: spawns the built bin (`dist/server.js`) as a child
 * process, connects a standard MCP client over stdio, and exercises
 * `tools/list` + one `tools/call` (search_lots). Prints the raw responses.
 *
 * Usage: npm run -w @radar/immo-mcp proof   (build runs first)
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, "..", "dist", "server.js");

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.execPath, // node
    args: [serverEntry],
    env: {
      ...process.env,
      IMMO_MCP_DATA_MODE: "mock",
      IMMO_MCP_AUTH_STUB_SUB: "demo-user",
      IMMO_MCP_AUTH_STUB_TENANT: "radar",
      IMMO_MCP_AUTH_STUB_SCOPES: "immo:read immo:search immo:documents:read",
    },
  });

  const client = new Client({ name: "immo-stdio-smoke", version: "0.0.0" });
  await client.connect(transport);

  console.log("=== tools/list ===");
  const { tools } = await client.listTools();
  console.log(JSON.stringify(tools.map((t) => ({ name: t.name, title: t.title })), null, 2));
  console.log(`tool count: ${tools.length}`);

  console.log("\n=== tools/call search_lots { city: 'longueuil' } ===");
  const res = await client.callTool({ name: "search_lots", arguments: { city: "longueuil" } });
  const content = (res.content as { type: string; text?: string }[]) ?? [];
  for (const block of content) {
    if (block.type === "text") console.log(block.text);
  }

  await client.close();
  console.log("\n=== OK: stdio round-trip succeeded ===");
}

main().catch((err) => {
  console.error(`stdio-smoke failed: ${String(err)}`);
  process.exit(1);
});
