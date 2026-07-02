/**
 * Server identity shared by BOTH transports (stdio `server.ts`, remote
 * `server-http.ts`). Deliberately its OWN module with NO other exports and NO
 * top-level side effects: `server.ts` has a module-level "run only when
 * executed directly as the bin" guard (compares `import.meta.url` to
 * `process.argv[1]`) that must NEVER be pulled into the `server-http.ts`
 * bundle. When esbuild bundles multiple entrypoints' modules together,
 * `import.meta.url` for every inlined module resolves to the SAME output
 * file's URL, so importing these constants directly from `server.ts` would
 * make its guard spuriously true inside the HTTP bundle — silently starting a
 * second, idle stdio `McpServer` (reading/writing stdio) alongside the
 * intended Streamable HTTP transport. Keep these two constants here so
 * neither transport's bundle ever needs to import the OTHER transport's
 * entrypoint module.
 */
export const IMMO_MCP_NAME = "immo";
export const IMMO_MCP_VERSION = "0.0.1";
